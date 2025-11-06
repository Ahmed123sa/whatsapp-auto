const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// WhatsApp configuration - Must be set via environment variables
const ADMIN_NUMBER = process.env.ADMIN_NUMBER;
const DESIGNERS_STRING = process.env.DESIGNERS;

// Validate required environment variables
if (!ADMIN_NUMBER) {
  console.error("❌ ERROR: ADMIN_NUMBER environment variable is required!");
  console.error(
    "Please set ADMIN_NUMBER in your Railway environment variables."
  );
  process.exit(1);
}

if (!DESIGNERS_STRING) {
  console.error("❌ ERROR: DESIGNERS environment variable is required!");
  console.error(
    "Please set DESIGNERS in your Railway environment variables (comma-separated)."
  );
  process.exit(1);
}

// Parse and validate designers
let DESIGNERS = DESIGNERS_STRING.split(",")
  .map((d) => d.trim())
  .filter((d) => d.length > 0);

if (DESIGNERS.length === 0) {
  console.error(
    "❌ ERROR: No valid designers found in DESIGNERS environment variable!"
  );
  process.exit(1);
}

// Validate and format designer numbers
DESIGNERS = DESIGNERS.map((designer) => {
  try {
    // If designer number doesn't end with @c.us, format it
    if (!designer.includes("@c.us")) {
      return formatWhatsAppNumber(designer);
    }
    return designer;
  } catch (error) {
    console.error(`❌ ERROR: Invalid designer number format: ${designer}`);
    process.exit(1);
  }
});

// Validate admin number format
let formattedAdminNumber;
try {
  if (!ADMIN_NUMBER.includes("@c.us")) {
    formattedAdminNumber = formatWhatsAppNumber(ADMIN_NUMBER);
  } else {
    formattedAdminNumber = ADMIN_NUMBER;
  }
} catch (error) {
  console.error(`❌ ERROR: Invalid admin number format: ${ADMIN_NUMBER}`);
  process.exit(1);
}

console.log("✅ Environment variables loaded and validated successfully:");
console.log("ADMIN_NUMBER:", formattedAdminNumber);
console.log("DESIGNERS:", DESIGNERS);
console.log("Number of designers:", DESIGNERS.length);

let currentQR = null;
let clientReady = false;

// Initialize WhatsApp client with LocalAuth for session persistence
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "whatsapp-session",
    dataPath: path.join(__dirname, ".wwebjs_auth"),
  }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
      // Railway-specific args
      "--disable-web-security",
      "--disable-features=VizDisplayCompositor",
      "--disable-ipc-flooding-protection",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
  },
  webVersionCache: {
    type: "remote",
    remotePath:
      "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
  },
});

// Generate QR code for authentication
client.on("qr", (qr) => {
  console.log("Scan this QR code with WhatsApp:");
  qrcode.generate(qr, { small: true });
  currentQR = qr;
  clientReady = false;
  console.log("QR code generated and stored for admin panel");
});

// When client is authenticated
client.on("authenticated", () => {
  console.log("WhatsApp client authenticated!");
});

// When client is ready
client.on("ready", () => {
  console.log("WhatsApp client is ready!");
  clientReady = true;
  currentQR = null; // Clear QR once connected
});

// Handle loading screen
client.on("loading_screen", (percent, message) => {
  console.log("Loading screen:", percent, "% -", message);
});

// Handle authentication failures
client.on("auth_failure", (msg) => {
  console.error("Authentication failed:", msg);
  clientReady = false;
  currentQR = null;
});

// Handle disconnections
client.on("disconnected", (reason) => {
  console.log("Client was disconnected:", reason);
  clientReady = false;
  currentQR = null;
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Function to load database
function loadDatabase() {
  try {
    const data = fs.readFileSync("database.json", "utf8");
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// Function to save database
function saveDatabase(data) {
  fs.writeFileSync("database.json", JSON.stringify(data, null, 2));
}

// Function to format phone number to WhatsApp format
function formatWhatsAppNumber(phone) {
  // Remove any non-numeric characters except +
  let cleanPhone = phone.replace(/[^\d+]/g, "");

  // If starts with +, remove it and treat as international
  if (cleanPhone.startsWith("+")) {
    cleanPhone = cleanPhone.substring(1);
  } else {
    // If starts with 0, remove it (Egyptian local format)
    if (cleanPhone.startsWith("0")) {
      cleanPhone = cleanPhone.substring(1);
    }
    // If doesn't start with country code, assume Egypt (20)
    if (!cleanPhone.startsWith("20")) {
      cleanPhone = "20" + cleanPhone;
    }
  }

  return cleanPhone + "@c.us";
}

// Create group endpoint
app.post("/create-group", async (req, res) => {
  console.log("🔄 Received group creation request:", {
    phone: req.body.phone,
    groupName: req.body.groupName,
  });

  try {
    const { phone, groupName } = req.body;

    if (!phone) {
      console.error("❌ Missing phone number in request");
      return res.status(400).json({ error: "Phone number is required" });
    }

    if (!groupName) {
      console.error("❌ Missing group name in request");
      return res.status(400).json({ error: "Group name is required" });
    }

    // Check if WhatsApp client is ready
    if (!client.info) {
      console.error("❌ WhatsApp client not ready:", {
        clientInfo: client.info,
        clientReady,
      });
      return res.status(503).json({
        error: "WhatsApp client is not ready",
        message: "يرجى ربط WhatsApp أولاً من خلال مسح رمز QR في Deploy Logs",
      });
    }

    console.log("✅ WhatsApp client is ready, proceeding with group creation");

    // Format client phone number
    const clientNumber = formatWhatsAppNumber(phone);
    console.log("📱 Formatted client phone number:", clientNumber);

    // Prepare participants
    const participants = [formattedAdminNumber, clientNumber, ...DESIGNERS];
    console.log("👥 Group participants:", participants);
    console.log("📊 Total participants:", participants.length);

    console.log("🏗️ Creating group with options:", {
      name: groupName,
      restrict: false,
      announce: false,
    });

    // Create group with settings to allow all members to send messages
    const group = await client.createGroup(groupName, participants, {
      restrict: false, // Allow all members to edit group info
      announce: false, // Allow all members to send messages
    });

    console.log("✅ Group created successfully:", {
      id: group.id._serialized,
      name: groupName,
      participantCount: participants.length,
    });

    // Return success immediately after group creation
    res.json({
      success: true,
      message: `تم إنشاء الجروب "${groupName}" بنجاح! يمكن لجميع الأعضاء إرسال الرسائل.`,
      groupId: group.id._serialized,
      groupName: groupName,
      participants: {
        admin: ADMIN_NUMBER,
        client: clientNumber,
        designers: DESIGNERS,
      },
    });

    // Handle post-creation tasks asynchronously (don't block the response)
    setImmediate(async () => {
      try {
        console.log("Starting post-creation tasks for group:", groupName);

        // Send welcome message
        try {
          const welcomeMessage = `مرحباً! هذا الجروب "${groupName}" مخصص لتصميمك الجديد 🎨\n\nيمكن لجميع الأعضاء إرسال الرسائل في هذا الجروب.`;
          await client.sendMessage(group.id._serialized, welcomeMessage);
          console.log("✓ Welcome message sent successfully");
        } catch (messageError) {
          console.warn(
            "✗ Could not send welcome message:",
            messageError.message
          );
        }

        // Save to database
        try {
          const database = loadDatabase();
          const groupData = {
            id: group.id._serialized,
            name: groupName,
            participants: participants,
            createdAt: new Date().toISOString(),
            clientNumber: clientNumber,
          };
          database.push(groupData);
          saveDatabase(database);
          console.log("✓ Group data saved to database");
        } catch (dbError) {
          console.warn("✗ Could not save to database:", dbError.message);
        }

        console.log("Post-creation tasks completed for group:", groupName);
      } catch (postCreationError) {
        console.error("Error in post-creation tasks:", postCreationError);
        // Don't send error response here as we already responded with success
      }
    });
  } catch (error) {
    console.error("Error creating group:", error);
    res.status(500).json({
      error: "Failed to create group",
      details: error.message,
    });
  }
});

// Health check endpoint for Railway
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    whatsappReady: client.info ? true : false,
  });
});

// WhatsApp status API for admin panel
app.get("/api/whatsapp-status", (req, res) => {
  res.json({
    ready: clientReady || (client.info ? true : false),
    qr: currentQR,
    info: client.info || null,
    state: client.state || "UNKNOWN",
  });
});

// QR code image endpoint
app.get("/api/qr-image", async (req, res) => {
  try {
    if (!currentQR) {
      return res.status(404).json({ error: "No QR code available" });
    }

    // Generate QR code as PNG image
    const qrImageBuffer = await QRCode.toBuffer(currentQR, {
      type: "png",
      width: 300,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    });

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache");
    res.send(qrImageBuffer);
  } catch (error) {
    console.error("Error generating QR image:", error);
    res.status(500).json({ error: "Failed to generate QR image" });
  }
});

// Groups API endpoint
app.get("/api/groups", (req, res) => {
  try {
    const database = loadDatabase();
    res.json({
      success: true,
      groups: database,
      total: database.length,
    });
  } catch (error) {
    console.error("Error loading groups:", error);
    res.status(500).json({
      error: "Failed to load groups",
      details: error.message,
    });
  }
});

// Admin panel
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// Root endpoint - serve the HTML page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Start server immediately (don't wait for WhatsApp)
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// Initialize WhatsApp client separately
client.initialize().catch((error) => {
  console.error("Failed to initialize WhatsApp client:", error);
  console.log("Server will continue running without WhatsApp functionality");
});
