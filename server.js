const express = require("express");
const { Client } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// WhatsApp configuration - Can be set via environment variables or defaults
const ADMIN_NUMBER = process.env.ADMIN_NUMBER || "201012345678@c.us";
const DESIGNERS = process.env.DESIGNERS
  ? process.env.DESIGNERS.split(",").map((d) => d.trim())
  : ["201098765432@c.us", "201011111111@c.us"];

console.log("Environment variables loaded:");
console.log("ADMIN_NUMBER:", ADMIN_NUMBER ? "Set" : "Not set");
console.log("DESIGNERS:", DESIGNERS.length > 0 ? "Set" : "Not set");

let currentQR = null;

// Initialize WhatsApp client
const client = new Client();

// Generate QR code for authentication
client.on("qr", (qr) => {
  console.log("Scan this QR code with WhatsApp:");
  qrcode.generate(qr, { small: true });
  currentQR = qr;
});

// When client is ready
client.on("ready", () => {
  console.log("WhatsApp client is ready!");
});

// Handle authentication failures
client.on("auth_failure", (msg) => {
  console.error("Authentication failed:", msg);
});

// Handle disconnections
client.on("disconnected", (reason) => {
  console.log("Client was disconnected:", reason);
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

  // If starts with +, remove it and assume international
  if (cleanPhone.startsWith("+")) {
    cleanPhone = cleanPhone.substring(1);
  }

  // If doesn't start with country code, assume Egypt (20)
  if (!cleanPhone.startsWith("20")) {
    cleanPhone = "20" + cleanPhone;
  }

  return cleanPhone + "@c.us";
}

// Create group endpoint
app.post("/create-group", async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    // Check if WhatsApp client is ready
    if (!client.info) {
      return res.status(503).json({
        error: "WhatsApp client is not ready",
        message: "يرجى ربط WhatsApp أولاً من خلال مسح رمز QR في Deploy Logs",
      });
    }

    // Format client phone number
    const clientNumber = formatWhatsAppNumber(phone);

    // Generate random ID for group
    const randomId = Math.random().toString(36).substring(2, 8);
    const groupName = `Client_Group_${randomId}`;

    // Prepare participants
    const participants = [ADMIN_NUMBER, clientNumber, ...DESIGNERS];

    console.log("Creating group:", groupName);
    console.log("Participants:", participants);

    // Create group
    const group = await client.createGroup(groupName, participants);

    // Send welcome message
    const welcomeMessage = "مرحباً! هذا الجروب مخصص لتصميمك الجديد 🎨";
    await client.sendMessage(group.id._serialized, welcomeMessage);

    // Save to database
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

    console.log("Group created successfully:", groupName);

    res.json({
      success: true,
      message: "تم إنشاء الجروب بنجاح",
      groupId: group.id._serialized,
      groupName: groupName,
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
    ready: client.info ? true : false,
    qr: currentQR,
    info: client.info || null,
  });
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
