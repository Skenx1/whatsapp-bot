const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, makeInMemoryStore } = require("@whiskeysockets/baileys")
const { Boom } = require("@hapi/boom")
const fs = require("fs")
const path = require("path")
const pino = require("pino")
const qrcode = require("qrcode-terminal")
const express = require("express")
const NodeCache = require("node-cache")
const readline = require("readline")

// Create Express app for keeping Render alive
const app = express()
const PORT = process.env.PORT || 3000

// Simple database to store user data
const DB_FILE = "bot_db.json"
let db = { warned: {} }

// Improved caching for better performance
const msgRetryCounterCache = new NodeCache()
// Create a store to cache messages (improves performance)
const store = makeInMemoryStore({ 
  logger: pino({ level: 'silent' }) 
})

// Create a silent logger to prevent terminal spam
const logger = pino({ 
  level: 'silent',  // Set to 'silent' to disable all logs
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname',
    },
  },
})

// Create auth state directory if it doesn't exist
if (!fs.existsSync('./auth')) {
  fs.mkdirSync('./auth')
}

// Load database if exists
if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"))
  } catch (error) {
    console.error("Error loading database:", error)
  }
}

// Save database with error handling
function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
  } catch (error) {
    console.error("Error saving database:", error)
  }
}

// Command handler
async function handleCommand(sock, msg, from, sender, groupMetadata, text) {
  const args = text.split(" ")
  const command = args[0].toLowerCase()
  const isAdmin = groupMetadata?.participants?.find((p) => p.id === sender)?.admin
  const isBotAdmin = groupMetadata?.participants?.find((p) => p.id === sock.user.id)?.admin

  // Help command
  if (command === "help") {
    const commands = [
      "*Available Commands:*",
      "",
      "*General Commands:*",
      "• !help - Show this help message",
      "• !ping - Check if bot is online",
      "• !groupinfo - Show group information",
      "• !tagall [message] - Tag all members",
      "• !warn @user - Warn a user",
      "• !unwarn @user - Remove warning from a user",
      "",
      "*Admin Commands:*",
      "• !kick @user - Remove a user from group",
      "• !add number - Add a user to group",
      "• !broadcast message - Send a broadcast message",
      "• !restart - Restart the bot",
      "",
      "Note: Replace @user with an actual mention, and [message] or number with the appropriate text.",
      "Admin commands can only be used by group admins.",
    ].join("\n")

    return sock.sendMessage(from, { text: commands }, { quoted: msg })
  }

  // Ping command
  if (command === "ping") {
    return sock.sendMessage(from, { text: "Pong! 🏓" }, { quoted: msg })
  }

  // Group info command
  if (command === "groupinfo" && groupMetadata) {
    const info = [
      `*Group Name:* ${groupMetadata.subject}`,
      `*Group ID:* ${from}`,
      `*Created By:* ${groupMetadata.owner || "Unknown"}`,
      `*Created On:* ${new Date(groupMetadata.creation * 1000).toLocaleString()}`,
      `*Member Count:* ${groupMetadata.participants.length}`,
      `*Description:* ${groupMetadata.desc || "No description"}`,
    ].join("\n")

    return sock.sendMessage(from, { text: info }, { quoted: msg })
  }

  // Tag all command
  if (command === "tagall") {
    if (!groupMetadata) {
      return sock.sendMessage(from, { text: "This command can only be used in groups!" }, { quoted: msg })
    }

    const message = args.slice(1).join(" ") || "ShabX 6x6y Bot"
    const mentions = groupMetadata.participants.map((participant) => participant.id)

    let text = `*${message}*\n\n`
    for (const participant of groupMetadata.participants) {
      text += `@${participant.id.split("@")[0]}\n`
    }

    return sock.sendMessage(
      from,
      {
        text: text,
        mentions: mentions,
      },
      { quoted: msg },
    )
  }

  // Warn command
  if (command === "warn") {
    const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid
    if (!mentioned || mentioned.length === 0) {
      return sock.sendMessage(from, { text: "Please mention a user to warn!" }, { quoted: msg })
    }

    const targetUser = mentioned[0]
    if (!db.warned[targetUser]) {
      db.warned[targetUser] = 0
    }

    db.warned[targetUser]++
    saveDB()

    return sock.sendMessage(
      from,
      {
        text: `@${targetUser.split("@")[0]} has been warned! (${db.warned[targetUser]} warnings)`,
        mentions: [targetUser],
      },
      { quoted: msg },
    )
  }

  // Unwarn command
  if (command === "unwarn") {
    const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid
    if (!mentioned || mentioned.length === 0) {
      return sock.sendMessage(from, { text: "Please mention a user to remove warning!" }, { quoted: msg })
    }

    const targetUser = mentioned[0]
    if (db.warned[targetUser] && db.warned[targetUser] > 0) {
      db.warned[targetUser]--
      if (db.warned[targetUser] === 0) {
        delete db.warned[targetUser]
      }
      saveDB()
    }

    return sock.sendMessage(
      from,
      {
        text: `Warning removed from @${targetUser.split("@")[0]}!`,
        mentions: [targetUser],
      },
      { quoted: msg },
    )
  }

  // Admin commands
  if (["kick", "add", "broadcast", "restart"].includes(command)) {
    // Check if user is admin
    if (!isAdmin) {
      return sock.sendMessage(from, { text: "You need to be an admin to use this command!" }, { quoted: msg })
    }

    // Handle kick command
    if (command === "kick") {
      if (!isBotAdmin) {
        return sock.sendMessage(from, { text: "I need to be an admin to kick users!" }, { quoted: msg })
      }

      const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid
      if (!mentioned || mentioned.length === 0) {
        return sock.sendMessage(from, { text: "Please mention a user to kick!" }, { quoted: msg })
      }

      const targetUser = mentioned[0]

      try {
        await sock.groupParticipantsUpdate(from, [targetUser], "remove")
        return sock.sendMessage(
          from,
          {
            text: `@${targetUser.split("@")[0]} has been kicked from the group!`,
            mentions: [targetUser],
          },
          { quoted: msg },
        )
      } catch (error) {
        return sock.sendMessage(from, { text: "Failed to kick user: " + error.message }, { quoted: msg })
      }
    }

    // Handle add command
    if (command === "add") {
      if (!isBotAdmin) {
        return sock.sendMessage(from, { text: "I need to be an admin to add users!" }, { quoted: msg })
      }

      if (args.length < 2) {
        return sock.sendMessage(from, { text: "Please provide a number to add!" }, { quoted: msg })
      }

      let number = args[1].replace(/[^0-9]/g, "")
      if (!number.startsWith("1") && !number.startsWith("1")) {
        number = "1" + number
      }
      if (!number.includes("@s.whatsapp.net")) {
        number = number + "@s.whatsapp.net"
      }

      try {
        await sock.groupParticipantsUpdate(from, [number], "add")
        return sock.sendMessage(from, { text: `User ${args[1]} has been added to the group!` }, { quoted: msg })
      } catch (error) {
        return sock.sendMessage(from, { text: "Failed to add user: " + error.message }, { quoted: msg })
      }
    }

    // Broadcast command
    if (command === "broadcast") {
      const message = args.slice(1).join(" ")
      if (!message) {
        return sock.sendMessage(from, { text: "Please provide a message to broadcast!" }, { quoted: msg })
      }

      return sock.sendMessage(from, {
        text: `*BROADCAST*\n\n${message}`,
      })
    }

    // Restart command
    if (command === "restart") {
      sock.sendMessage(from, { text: "Restarting bot..." }, { quoted: msg }).then(() => {
        console.log("Restarting bot by user command...")
        process.exit(0) // Render will automatically restart the process
      })
    }
  }
}

// Global socket variable
let sock = null
let connectionTimeout = null

// Function to create a smaller QR code
function generateSmallQR(qr) {
  // Clear console to make QR code more visible
  console.clear()
  console.log("\n=== SCAN THIS QR CODE TO LOGIN ===\n")
  
  // Generate a tiny QR code
  qrcode.generate(qr, { 
    small: true,
    scale: 1  // Smallest possible scale
  })
  
  console.log("\n=== SCAN ABOVE QR CODE TO LOGIN ===\n")
}

// Function to handle pairing code authentication
async function pairWithCode(sock, phoneNumber) {
  try {
    // Request pairing code for the phone number
    const code = await sock.requestPairingCode(phoneNumber)
    console.log(`\n=== PAIRING CODE ===\n${code}\n=== ENTER THIS CODE ON YOUR WHATSAPP ===\n`)
    
    // Instructions for the user
    console.log("1. Open WhatsApp on your phone")
    console.log("2. Tap Menu or Settings and select Linked Devices")
    console.log("3. Tap on 'Link a Device'")
    console.log("4. When prompted for a QR code scan, tap 'Link with phone number instead'")
    console.log(`5. Enter your phone number and then the pairing code: ${code}`)
    
    return code
  } catch (error) {
    console.error("Error requesting pairing code:", error)
    return null
  }
}

// Function to handle connection retries with exponential backoff
async function connectWithRetry(retryCount = 0) {
  try {
    await startBot()
  } catch (error) {
    const delay = Math.min(Math.pow(2, retryCount) * 1000, 60000) // Max 1 minute delay
    console.log(`Connection attempt failed. Retrying in ${delay/1000} seconds...`)
    setTimeout(() => connectWithRetry(retryCount + 1), delay)
  }
}

// Main bot function with improved error handling
async function startBot() {
  try {
    // Fetch the latest version of Baileys
    const { version } = await fetchLatestBaileysVersion()
    
    // Create auth state with better error handling
    const { state, saveCreds } = await useMultiFileAuthState("auth")
    
    // Create socket connection with improved settings
    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        // Use caching for better performance
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false, // We'll handle QR code display ourselves
      logger,
      msgRetryCounterCache,
      defaultQueryTimeoutMs: 30000, // Reduced timeout for faster response
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000, // Keep connection alive
      emitOwnEvents: true, // For better event handling
      browser: ['WhatsApp Bot', 'Chrome', '103.0.5060.114'], // More stable browser signature
      markOnlineOnConnect: true, // Mark as online when connected
      syncFullHistory: false, // Don't sync full history for faster startup
      generateHighQualityLinkPreview: false, // Disable link previews for better performance
      transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 }, // More reliable transactions
      getMessage: async (key) => {
        // Get message from store to reduce server requests
        if (store) {
          const msg = await store.loadMessage(key.remoteJid, key.id)
          return msg?.message || undefined
        }
        return { conversation: '' }
      }
    })
    
    // Bind the store to the socket
    store.bind(sock.ev)

    // Save credentials when updated
    sock.ev.on("creds.update", saveCreds)

    // Handle connection updates with improved error handling
    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      // Clear any existing connection timeout
      if (connectionTimeout) {
        clearTimeout(connectionTimeout)
        connectionTimeout = null
      }
      
      // Handle QR code with smaller display
      if (qr) {
        generateSmallQR(qr)
        
        // Also try pairing code method if QR is shown
        // This is a fallback in case the user wants to use pairing code instead
        console.log("\nIf QR code is not scanning well, you can use the pairing code method.")
        console.log("Visit the web interface and enter your phone number to get a pairing code.")
      }
      
      // Handle connection status
      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut
        
        if (shouldReconnect) {
          console.log("Reconnecting...")
          connectWithRetry()
        } else if (statusCode === DisconnectReason.loggedOut) {
          console.log("Logged out. Please authenticate again.")
          // Delete auth folder to force new login
          try {
            fs.rmSync('./auth', { recursive: true, force: true })
            fs.mkdirSync('./auth')
          } catch (error) {
            console.error("Error resetting auth:", error)
          }
          connectWithRetry()
        }
      } else if (connection === "open") {
        console.log("Bot connected successfully!")
      }
    })

    // Handle messages with improved error handling and NO console logging
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      try {
        if (!messages || !messages[0]) return
        
        const msg = messages[0]
        if (!msg.message) return

        const from = msg.key.remoteJid
        if (!from) return
        
        const isGroup = from.endsWith("@g.us")
        const sender = msg.key.participant || from

        // Get message content
        const body = (
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.videoMessage?.caption ||
          ""
        ).trim()

        // Handle group-specific actions
        let groupMetadata = null
        if (isGroup) {
          try {
            groupMetadata = await sock.groupMetadata(from)
          } catch (error) {
            // Silent error handling
          }

          // Handle commands
          if (body.startsWith("!")) {
            const text = body.slice(1)
            return await handleCommand(sock, msg, from, sender, groupMetadata, text)
          }
        }
        
        // No console logging of messages
      } catch (error) {
        // Silent error handling
      }
    })

    // Handle group participants update (joins/leaves)
    sock.ev.on("group-participants.update", async ({ id, participants, action }) => {
      try {
        // Get group metadata
        const groupMetadata = await sock.groupMetadata(id)

        // Handle new participants
        if (action === "add") {
          for (const participant of participants) {
            // Send welcome message
            sock.sendMessage(id, {
              text: `Welcome @${participant.split("@")[0]} to ${groupMetadata.subject}! 👋`,
              mentions: [participant],
            })
          }
        }

        // Handle participants who left
        if (action === "remove") {
          for (const participant of participants) {
            // Send goodbye message
            sock.sendMessage(id, {
              text: `@${participant.split("@")[0]} has left the group. Goodbye! 👋`,
              mentions: [participant],
            })
          }
        }
      } catch (error) {
        // Silent error handling
      }
    })

    // Set up a watchdog timer to detect and fix connection issues
    connectionTimeout = setTimeout(() => {
      if (sock) {
        sock.end()
        connectWithRetry()
      }
    }, 60000) // 1 minute timeout
    
    return sock
  } catch (error) {
    console.error("Fatal error starting bot:", error)
    throw error // Rethrow for retry mechanism
  }
}

// Create readline interface for pairing code input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

// Set up Express server with pairing code functionality
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.get('/', (req, res) => {
  const status = sock?.user ? 'Connected as ' + sock.user.name : 'Connecting...'
  res.send(`
    <html>
      <head>
        <title>WhatsApp Bot Status</title>
        <meta http-equiv="refresh" content="30">
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; line-height: 1.6; background-color: #f5f5f5; }
          .container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .status { padding: 15px; border-radius: 5px; margin-bottom: 20px; }
          .online { background-color: #d4edda; color: #155724; }
          .offline { background-color: #f8d7da; color: #721c24; }
          .info { background-color: #d1ecf1; color: #0c5460; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
          .form-group { margin-bottom: 15px; }
          label { display: block; margin-bottom: 5px; font-weight: bold; }
          input[type="text"] { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
          button { background-color: #4CAF50; color: white; border: none; padding: 10px 15px; border-radius: 4px; cursor: pointer; }
          button:hover { background-color: #45a049; }
          .qr-info { background-color: #fff3cd; color: #856404; padding: 15px; border-radius: 5px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>WhatsApp Bot Status</h1>
          <div class="status ${sock?.user ? 'online' : 'offline'}">
            <strong>Status:</strong> ${status}
          </div>
          
          <div class="info">
            <p>This page refreshes automatically every 30 seconds.</p>
            <p>Last checked: ${new Date().toLocaleString()}</p>
          </div>
          
          ${!sock?.user ? `
          <div class="pairing">
            <h2>Connect with Pairing Code</h2>
            <p>If QR code scanning is difficult, you can use a pairing code instead:</p>
            
            <form action="/pair" method="post">
              <div class="form-group">
                <label for="phoneNumber">Your Phone Number (with country code):</label>
                <input type="text" id="phoneNumber" name="phoneNumber" placeholder="e.g. +1234567890" required>
              </div>
              <button type="submit">Get Pairing Code</button>
            </form>
            
            <div class="qr-info">
              <p>If you prefer to scan a QR code, check the console logs in your Render dashboard.</p>
            </div>
          </div>
          ` : ''}
        </div>
      </body>
    </html>
  `)
})

// Endpoint to handle pairing code requests
app.post('/pair', async (req, res) => {
  const { phoneNumber } = req.body
  
  if (!phoneNumber) {
    return res.status(400).send('Phone number is required')
  }
  
  // Format phone number (remove spaces, make sure it has + prefix)
  const formattedNumber = phoneNumber.replace(/\s+/g, '').startsWith('+') 
    ? phoneNumber.replace(/\s+/g, '') 
    : '+' + phoneNumber.replace(/\s+/g, '')
  
  try {
    if (!sock) {
      return res.status(500).send('Bot is not initialized yet. Please try again in a few moments.')
    }
    
    const code = await pairWithCode(sock, formattedNumber)
    
    if (code) {
      res.send(`
        <html>
          <head>
            <title>WhatsApp Pairing Code</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 0; padding: 20px; line-height: 1.6; background-color: #f5f5f5; }
              .container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
              .code { font-size: 32px; letter-spacing: 5px; text-align: center; margin: 20px 0; font-weight: bold; }
              .steps { background-color: #d1ecf1; color: #0c5460; padding: 15px; border-radius: 5px; margin: 20px 0; }
              .steps ol { margin-left: 20px; }
              .back { display: inline-block; margin-top: 20px; color: #0366d6; text-decoration: none; }
              .back:hover { text-decoration: underline; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>WhatsApp Pairing Code</h1>
              <p>Use this code to link your WhatsApp account:</p>
              
              <div class="code">${code}</div>
              
              <div class="steps">
                <h3>How to use this code:</h3>
                <ol>
                  <li>Open WhatsApp on your phone</li>
                  <li>Tap Menu or Settings and select <strong>Linked Devices</strong></li>
                  <li>Tap on <strong>Link a Device</strong></li>
                  <li>When prompted for a QR code scan, tap <strong>Link with phone number instead</strong></li>
                  <li>Enter your phone number and then the pairing code shown above</li>
                </ol>
              </div>
              
              <a href="/" class="back">← Back to Status Page</a>
            </div>
          </body>
        </html>
      `)
    } else {
      res.status(500).send('Failed to generate pairing code. Please try again.')
    }
  } catch (error) {
    console.error('Error generating pairing code:', error)
    res.status(500).send('An error occurred while generating the pairing code. Please try again.')
  }
})

// Start the Express server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...')
  if (sock) sock.end()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...')
  if (sock) sock.end()
  process.exit(0)
})

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err)
  // Don't exit, just log the error
})

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  // Don't exit, just log the error
})

// Start the bot
console.log("Starting WhatsApp Bot...")
connectWithRetry()
