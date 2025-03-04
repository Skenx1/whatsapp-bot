const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys")
const { Boom } = require("@hapi/boom")
const fs = require("fs")
const path = require("path")
const qrcode = require("qrcode-terminal")
const figlet = require("figlet")
const chalk = require("chalk")

// Simple database to store user data and statuses
const DB_FILE = "bot_db.json"
let db = { warned: {}, statuses: {} }

// Load database if exists
if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"))
  } catch (error) {
    console.error("Error loading database:", error)
  }
}

// Save database
function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
}

// Fancy console log
function fancyLog(text) {
  console.log(chalk.cyan(figlet.textSync(text, { font: "Small" })))
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
      "*🌟 Available Commands 🌟*",
      "",
      "*📚 General Commands:*",
      "• !help - Show this help message",
      "• !ping - Check if bot is online",
      "• !groupinfo - Show group information",
      "• !tagall [message] - Tag all members",
      "• !warn @user - Warn a user",
      "• !unwarn @user - Remove warning from a user",
      "• !savequote [text] - Save a quote",
      "• !getquote - Get a random saved quote",
      "• !weather [city] - Get weather information",
      "• !joke - Get a random joke",
      "• !flip - Flip a coin",
      "• !roll [number] - Roll a dice",
      "• !calculate [expression] - Calculate a mathematical expression",
      "",
      "*👑 Admin Commands:*",
      "• !kick @user - Remove a user from group",
      "• !add number - Add a user to group",
      "• !broadcast message - Send a broadcast message",
      "• !restart - Restart the bot",
      "",
      "Note: Replace @user with an actual mention, and [text] with appropriate content.",
      "Admin commands can only be used by group admins.",
    ].join("\n")

    return sock.sendMessage(from, { text: commands }, { quoted: msg })
  }

  // Ping command
  if (command === "ping") {
    return sock.sendMessage(from, { text: "Pong! 🏓 Bot is online and ready!" }, { quoted: msg })
  }

  // Group info command
  if (command === "groupinfo" && groupMetadata) {
    const info = [
      `*📊 Group Information 📊*`,
      ``,
      `*🏷️ Name:* ${groupMetadata.subject}`,
      `*🆔 ID:* ${from}`,
      `*👑 Created By:* ${groupMetadata.owner || "Unknown"}`,
      `*📅 Created On:* ${new Date(groupMetadata.creation * 1000).toLocaleString()}`,
      `*👥 Member Count:* ${groupMetadata.participants.length}`,
      `*📝 Description:* ${groupMetadata.desc || "No description"}`,
    ].join("\n")

    return sock.sendMessage(from, { text: info }, { quoted: msg })
  }

  // Tag all command
  if (command === "tagall") {
    if (!groupMetadata) {
      return sock.sendMessage(from, { text: "This command can only be used in groups!" }, { quoted: msg })
    }

    const message = args.slice(1).join(" ") || "Hello everyone!"
    const mentions = groupMetadata.participants.map((participant) => participant.id)

    let text = `*📢 Attention Everyone! 📢*\n\n${message}\n\n`
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
        text: `⚠️ @${targetUser.split("@")[0]} has been warned! (${db.warned[targetUser]} warnings)`,
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
        text: `✅ Warning removed from @${targetUser.split("@")[0]}!`,
        mentions: [targetUser],
      },
      { quoted: msg },
    )
  }

  // Save quote command
  if (command === "savequote") {
    const quote = args.slice(1).join(" ")
    if (!quote) {
      return sock.sendMessage(from, { text: "Please provide a quote to save!" }, { quoted: msg })
    }

    if (!db.statuses[from]) {
      db.statuses[from] = []
    }
    db.statuses[from].push(quote)
    saveDB()

    return sock.sendMessage(from, { text: "✅ Quote saved successfully!" }, { quoted: msg })
  }

  // Get quote command
  if (command === "getquote") {
    if (!db.statuses[from] || db.statuses[from].length === 0) {
      return sock.sendMessage(from, { text: "No quotes saved for this group!" }, { quoted: msg })
    }

    const randomQuote = db.statuses[from][Math.floor(Math.random() * db.statuses[from].length)]
    return sock.sendMessage(from, { text: `📜 Random Quote:\n\n"${randomQuote}"` }, { quoted: msg })
  }

  // Weather command (Note: This is a mock implementation)
  if (command === "weather") {
    const city = args.slice(1).join(" ")
    if (!city) {
      return sock.sendMessage(from, { text: "Please provide a city name!" }, { quoted: msg })
    }

    const mockWeather = ["Sunny", "Cloudy", "Rainy", "Windy", "Snowy"][Math.floor(Math.random() * 5)]
    const mockTemp = Math.floor(Math.random() * 35) + 5 // Random temperature between 5°C and 40°C

    return sock.sendMessage(from, { text: `🌤️ Weather in ${city}:\n${mockWeather}, ${mockTemp}°C` }, { quoted: msg })
  }

  // Joke command
  if (command === "joke") {
    const jokes = [
      "Why don't scientists trust atoms? Because they make up everything!",
      "Why did the scarecrow win an award? He was outstanding in his field!",
      "Why don't eggs tell jokes? They'd crack each other up!",
      "Why don't skeletons fight each other? They don't have the guts!",
      "What do you call a fake noodle? An impasta!",
    ]
    const randomJoke = jokes[Math.floor(Math.random() * jokes.length)]
    return sock.sendMessage(from, { text: `😂 Here's a joke:\n\n${randomJoke}` }, { quoted: msg })
  }

  // Flip coin command
  if (command === "flip") {
    const result = Math.random() < 0.5 ? "Heads" : "Tails"
    return sock.sendMessage(from, { text: `🪙 Coin flip result: ${result}` }, { quoted: msg })
  }

  // Roll dice command
  if (command === "roll") {
    const sides = Number.parseInt(args[1]) || 6
    const result = Math.floor(Math.random() * sides) + 1
    return sock.sendMessage(from, { text: `🎲 Dice roll result (${sides}-sided): ${result}` }, { quoted: msg })
  }

  // Calculate command
  if (command === "calculate") {
    const expression = args.slice(1).join(" ")
    if (!expression) {
      return sock.sendMessage(from, { text: "Please provide a mathematical expression!" }, { quoted: msg })
    }

    try {
      const result = eval(expression)
      return sock.sendMessage(from, { text: `🧮 Result: ${expression} = ${result}` }, { quoted: msg })
    } catch (error) {
      return sock.sendMessage(from, { text: "Invalid expression. Please try again." }, { quoted: msg })
    }
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
            text: `👢 @${targetUser.split("@")[0]} has been kicked from the group!`,
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
        return sock.sendMessage(from, { text: `✅ User ${args[1]} has been added to the group!` }, { quoted: msg })
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
        text: `*📢 BROADCAST*\n\n${message}`,
      })
    }

    // Restart command
    if (command === "restart") {
      sock.sendMessage(from, { text: "🔄 Restarting bot..." }, { quoted: msg }).then(() => process.exit(0))
    }
  }
}

let sock // Declare sock outside startBot

async function startBot() {
  // Create auth state
  const { state, saveCreds } = await useMultiFileAuthState("auth")

  // Create socket connection
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    defaultQueryTimeoutMs: 60000, // Increase timeout for slow connections
    qrTimeout: 60000, // Add this line to increase QR code timeout
  })

  // Save credentials when updated
  sock.ev.on("creds.update", saveCreds)

  // Handle connection updates
  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrcode.generate(qr, { small: true }) // Generate smaller QR code
    }
    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error instanceof Boom && lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut

      console.log("Connection closed due to ", lastDisconnect?.error, ", reconnecting:", shouldReconnect)

      if (shouldReconnect) {
        startBot()
      }
    } else if (connection === "open") {
      fancyLog("Bot Connected!")
    }
  })

  // Handle messages
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    try {
      const msg = messages[0]
      if (!msg.message) return

      const from = msg.key.remoteJid
      const isGroup = from.endsWith("@g.us")
      const sender = msg.key.participant || from

      // Get message content
      const messageType = Object.keys(msg.message)[0]
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
        groupMetadata = await sock.groupMetadata(from)

        // Handle commands
        if (body.startsWith("!")) {
          const text = body.slice(1)
          return await handleCommand(sock, msg, from, sender, groupMetadata, text)
        }
      }

      // Log message for debugging
      console.log(chalk.green(`[${new Date().toLocaleString()}] Message from ${sender} in ${from}: ${body}`))
    } catch (error) {
      console.error("Error processing message:", error)
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
            text: `👋 Welcome @${participant.split("@")[0]} to ${groupMetadata.subject}!`,
            mentions: [participant],
          })
        }
      }

      // Handle participants who left
      if (action === "remove") {
        for (const participant of participants) {
          // Send goodbye message
          sock.sendMessage(id, {
            text: `👋 @${participant.split("@")[0]} has left the group. Goodbye!`,
            mentions: [participant],
          })
        }
      }
    } catch (error) {
      console.error("Error handling group update:", error)
    }
  })
}

// Start the bot
fancyLog("Starting WhatsApp Bot")
startBot()

