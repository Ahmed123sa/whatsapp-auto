const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8000;

// WhatsApp configuration - Use environment variables or defaults for local testing
const ADMIN_NUMBER = process.env.ADMIN_NUMBER || "201012345678@c.us";
const DESIGNERS_STRING =
  process.env.DESIGNERS || "201098765432@c.us,201011111111@c.us";

// App customization - Use environment variables or defaults
const APP_CONFIG = {
  title: process.env.APP_TITLE || "AutoGroup WhatsApp",
  subtitle: process.env.APP_SUBTITLE || "انشاء جروب واتساب تلقائي للعملاء",
  groupNameLabel: process.env.GROUP_NAME_LABEL || "اسم الجروب",
  phoneLabel: process.env.PHONE_LABEL || "رقم الهاتف",
  submitButtonText: process.env.SUBMIT_BUTTON_TEXT || "ابدأ المحادثة",
  welcomeMessage:
    process.env.WELCOME_MESSAGE ||
    'مرحباً! هذا الجروب "{GROUP_NAME}" مخصص لتصميمك الجديد 🎨\n\nيمكن لجميع الأعضاء إرسال الرسائل في هذا الجروب.',
  successMessage:
    process.env.SUCCESS_MESSAGE ||
    'تم إنشاء الجروب "{GROUP_NAME}" بنجاح! يمكن لجميع الأعضاء إرسال الرسائل.',
  errorMessage: process.env.ERROR_MESSAGE || "حدث خطأ غير متوقع",
};

console.log("🔧 Loading WhatsApp configuration...");
console.log("📋 Environment check:");
console.log(
  "   ADMIN_NUMBER:",
  process.env.ADMIN_NUMBER ? "Set from env" : "Using default"
);
console.log(
  "   DESIGNERS:",
  process.env.DESIGNERS ? "Set from env" : "Using defaults"
);

// Parse and validate designers
let DESIGNERS = DESIGNERS_STRING.split(",")
  .map((d) => d.trim())
  .filter((d) => d.length > 0);

console.log("👥 Raw designers from config:", DESIGNERS);

// Validate and format designer numbers
DESIGNERS = DESIGNERS.map((designer, index) => {
  console.log(`🔄 Processing designer ${index + 1}:`, designer);
  try {
    // If designer number doesn't end with @c.us, format it
    if (!designer.includes("@c.us")) {
      const formatted = formatWhatsAppNumber(designer);
      console.log(`   ✅ Formatted to:`, formatted);
      return formatted;
    }
    console.log(`   ✅ Already formatted:`, designer);
    return designer;
  } catch (error) {
    console.error(
      `❌ ERROR: Invalid designer number format: ${designer}`,
      error
    );
    return null;
  }
}).filter((d) => d !== null);

if (DESIGNERS.length === 0) {
  console.error("❌ ERROR: No valid designers found!");
  console.error(
    "Please check your DESIGNERS environment variable or defaults."
  );
  process.exit(1);
}

// Validate admin number format
let formattedAdminNumber;
try {
  if (!ADMIN_NUMBER.includes("@c.us")) {
    formattedAdminNumber = formatWhatsAppNumber(ADMIN_NUMBER);
    console.log(
      "📱 Admin number formatted from:",
      ADMIN_NUMBER,
      "to:",
      formattedAdminNumber
    );
  } else {
    formattedAdminNumber = ADMIN_NUMBER;
    console.log("📱 Admin number already formatted:", formattedAdminNumber);
  }
} catch (error) {
  console.error(
    `❌ ERROR: Invalid admin number format: ${ADMIN_NUMBER}`,
    error
  );
  process.exit(1);
}

console.log("✅ Configuration loaded successfully:");
console.log("   📞 ADMIN_NUMBER:", formattedAdminNumber);
console.log("   👨‍🎨 DESIGNERS:", DESIGNERS);
console.log("   📊 Total designers:", DESIGNERS.length);

// Function to detect hosting provider
function getHostingProvider() {
  if (process.env.RAILWAY_ENVIRONMENT) return "railway";
  if (process.env.HEROKU_APP_ID) return "heroku";
  if (process.env.VERCEL) return "vercel";
  if (process.env.DIGITAL_OCEAN || process.env.DO_APP_NAME)
    return "digitalocean";
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return "aws";
  return process.env.HOSTING_PROVIDER || "default";
}

// Function to get Puppeteer config based on hosting
function getPuppeteerConfig(provider) {
  const baseConfig = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--disable-gpu",
    ],
  };

  console.log(`🌐 Detected hosting provider: ${provider}`);

  switch (provider) {
    case "railway":
      baseConfig.args.push(
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
        "--disable-ipc-flooding-protection",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows"
      );
      console.log("⚙️ Applied Railway-specific Puppeteer config");
      break;

    case "heroku":
      baseConfig.args.push("--disable-gpu", "--disable-software-rasterizer");
      console.log("⚙️ Applied Heroku-specific Puppeteer config");
      break;

    case "digitalocean":
      // VPS typically has more resources, minimal args needed
      baseConfig.args.push("--disable-dev-tools");
      console.log("⚙️ Applied DigitalOcean-specific Puppeteer config");
      break;

    case "aws":
      baseConfig.args.push(
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-background-timer-throttling"
      );
      console.log("⚙️ Applied AWS-specific Puppeteer config");
      break;

    case "vercel":
    case "netlify":
      console.log(
        "⚠️ Warning: Serverless platforms may not be suitable for Puppeteer"
      );
      baseConfig.args.push("--disable-gpu");
      break;

    default:
      console.log("⚙️ Applied default Puppeteer config");
      break;
  }

  return baseConfig;
}

const hostingProvider = getHostingProvider();

let currentQR = null;
let clientReady = false;

// Initialize WhatsApp client with LocalAuth for session persistence
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "whatsapp-session",
    dataPath: path.join(__dirname, ".wwebjs_auth"),
  }),
  puppeteer: getPuppeteerConfig(hostingProvider),
  webVersionCache: {
    type: "remote",
    remotePath:
      "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
  },
});

// Generate QR code for authentication
client.on("qr", (qr) => {
  console.log("🔳 QR Code generated for WhatsApp authentication");
  console.log("📱 Please scan this QR code with WhatsApp:");
  qrcode.generate(qr, { small: true });
  currentQR = qr;
  clientReady = false;
  console.log("✅ QR code stored for admin panel access");
});

// When client is authenticated
client.on("authenticated", () => {
  console.log("🔐 WhatsApp client authenticated successfully!");
});

// When client is ready
client.on("ready", () => {
  console.log("🚀 WhatsApp client is ready and connected!");
  console.log("📊 Client info:", client.info);
  clientReady = true;
  currentQR = null; // Clear QR once connected
});

// Handle loading screen
client.on("loading_screen", (percent, message) => {
  console.log(`⏳ WhatsApp loading: ${percent}% - ${message}`);
});

// Handle authentication failures
client.on("auth_failure", (msg) => {
  console.error("❌ WhatsApp authentication failed:", msg);
  clientReady = false;
  currentQR = null;
});

// Handle disconnections
client.on("disconnected", (reason) => {
  console.log("📴 WhatsApp client disconnected:", reason);
  clientReady = false;
  currentQR = null;
});

// Handle messages for debugging
client.on("message", (msg) => {
  console.log("💬 New message received:", {
    from: msg.from,
    body: msg.body.substring(0, 50) + (msg.body.length > 50 ? "..." : ""),
    type: msg.type,
  });
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

    // Prepare participants - ensure no duplicates
    const participants = [formattedAdminNumber, clientNumber, ...DESIGNERS];
    const uniqueParticipants = [...new Set(participants)]; // Remove duplicates

    console.log("👥 Group participants (before deduplication):", participants);
    console.log(
      "👥 Group participants (after deduplication):",
      uniqueParticipants
    );
    console.log("📊 Total participants:", uniqueParticipants.length);

    // Check if we have enough unique participants
    if (uniqueParticipants.length < 2) {
      console.error("❌ Not enough unique participants for group creation");
      return res.status(400).json({
        error: "Not enough unique participants",
        message: "يجب أن يكون هناك مشاركين مختلفين على الأقل",
      });
    }

    console.log("🏗️ Creating group with options:", {
      name: groupName,
      restrict: false,
      announce: false,
    });

    // Create group with settings to allow all members to send messages
    console.log("🔄 Calling client.createGroup...");
    let group;
    try {
      group = await client.createGroup(groupName, uniqueParticipants, {
        restrict: false, // Allow all members to edit group info
        announce: false, // Allow all members to send messages
      });
    } catch (createError) {
      console.warn(
        "⚠️ First createGroup attempt failed, trying without options:",
        createError.message
      );
      // Fallback: try creating without options
      group = await client.createGroup(groupName, uniqueParticipants);
    }

    console.log("📦 createGroup result:", group);

    // Check if group creation was successful
    if (!group) {
      console.error("❌ Group creation failed - returned null/undefined");
      return res.status(500).json({
        error: "Failed to create group",
        details:
          "WhatsApp group creation returned null. Check participant numbers and WhatsApp connection.",
      });
    }

    if (!group.gid || !group.gid._serialized) {
      console.error("❌ Group creation failed - invalid group object:", group);
      return res.status(500).json({
        error: "Failed to create group",
        details:
          "Invalid group object returned from WhatsApp. Check participant numbers.",
      });
    }

    console.log("✅ Group created successfully:", {
      id: group.gid._serialized,
      name: groupName,
      participantCount: uniqueParticipants.length,
    });

    // Note: Group settings (announce/restrict) are set during creation
    // and cannot be modified after in whatsapp-web.js v1.34.1
    console.log(
      "ℹ️ Group settings are configured during creation (announce: false, restrict: false)"
    );

    // Promote all participants to admin status
    try {
      console.log("👑 Promoting all participants to admin status...");

      // Wait longer for group to stabilize after settings update
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Get current group info to check participants
      const groupInfo = await client.getChatById(group.gid._serialized);
      console.log("📊 Group info after creation:", {
        participantsCount: groupInfo.participants?.length || 0,
        participants:
          groupInfo.participants?.map((p) => ({
            id: p.id._serialized,
            isAdmin: p.isAdmin || false,
          })) || [],
      });

      // Get group chat object for promotion
      const groupChat = await client.getChatById(group.gid._serialized);

      // Function to promote participants with retries
      async function promoteWithRetry(participantsToPromote, participantType) {
        let retries = 3;
        while (retries > 0) {
          try {
            await groupChat.promoteParticipants(participantsToPromote);
            console.log(
              `✓ Promoted ${participantType} to admin:`,
              participantsToPromote
            );
            return true;
          } catch (promoteError) {
            console.warn(
              `⚠️ Failed to promote ${participantType} (retries left: ${
                retries - 1
              }):`,
              promoteError.message
            );
            retries--;
            if (retries > 0) {
              await new Promise((resolve) => setTimeout(resolve, 3000));
            }
          }
        }
        return false;
      }

      // Promote client to admin
      const clientPromoted = await promoteWithRetry([clientNumber], "client");

      // Promote all designers to admin
      const designerResults = [];
      if (DESIGNERS.length > 0) {
        const designersPromoted = await promoteWithRetry(
          DESIGNERS,
          "designers"
        );
        designerResults.push({
          designers: DESIGNERS,
          promoted: designersPromoted,
        });
      }

      // Wait a bit more before verification
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify final admin status
      const finalGroupInfo = await client.getChatById(group.gid._serialized);
      console.log("✅ Final group admin status:", {
        participantsCount: finalGroupInfo.participants?.length || 0,
        admins:
          finalGroupInfo.participants
            ?.filter((p) => p.isAdmin)
            .map((p) => p.id._serialized) || [],
        nonAdmins:
          finalGroupInfo.participants
            ?.filter((p) => !p.isAdmin)
            .map((p) => p.id._serialized) || [],
      });

      // Log promotion results
      console.log("📊 Promotion results:", {
        clientPromoted,
        designers: designerResults,
        totalAdmins:
          finalGroupInfo.participants?.filter((p) => p.isAdmin).length || 0,
      });

      console.log("✅ Admin promotion process completed");
    } catch (promoteError) {
      console.error(
        "❌ Critical error in admin promotion:",
        promoteError.message
      );
      // Log but don't fail the request
    }

    // Return success immediately after group creation
    res.json({
      success: true,
      message: `تم إنشاء الجروب "${groupName}" بنجاح! يمكن لجميع الأعضاء إرسال الرسائل.`,
      groupId: group.gid._serialized,
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
          const welcomeMessage = APP_CONFIG.welcomeMessage.replace(
            "{GROUP_NAME}",
            groupName
          );
          await client.sendMessage(group.gid._serialized, welcomeMessage);
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
            id: group.gid._serialized,
            name: groupName,
            participants: uniqueParticipants,
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

// App config API endpoint - serves customizable text
app.get("/api/config", (req, res) => {
  res.json({
    success: true,
    config: APP_CONFIG,
  });
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
