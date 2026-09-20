const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const fs = require("fs");
const { MongoClient } = require("mongodb");

dotenv.config();

console.log("GEMINI KEY LOADED:", !!process.env.GEMINI_API_KEY);

const { GoogleGenAI } = require("@google/genai");
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

const stationsData = JSON.parse(
  fs.readFileSync("./stations.json", "utf8")
);

const stations = Array.isArray(stationsData)
  ? stationsData
  : stationsData.stations;

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017";

const RAILRADAR_API_KEY = process.env.RAILRADAR_API_KEY;

const client = new MongoClient(MONGODB_URI);

let db;

async function startServer() {
  try {
    await client.connect();

    console.log("MongoDB Connected Successfully 🚆");

    db = client.db("railexpress");

    let ghostHistory = [];

    // MongoDB me test data save karne ke liye
    app.post("/api/test", async (req, res) => {
      try {
        const collection = db.collection("test");

        const result = await collection.insertOne({
          message: "RailExpress MongoDB Test",
          createdAt: new Date()
        });

        res.json({
          success: true,
          message: "Data MongoDB me save ho gaya 🚆",
          id: result.insertedId
        });

      } catch (error) {
        console.error(error);

        res.status(500).json({
          success: false,
          message: "Data save nahi hua"
        });
      }
    });

    // Test trains MongoDB me save karne ke liye
    app.post("/api/trains/test", async (req, res) => {
      try {
        const trains = [
          {
            trainNumber: "12951",
            trainName: "Mumbai Rajdhani Express",
            from: "NDLS",
            to: "BPL",
            departure: "16:55",
            arrival: "23:10",
            days: "Daily"
          },
          {
            trainNumber: "12952",
            trainName: "Mumbai Rajdhani Express",
            from: "BPL",
            to: "NDLS",
            departure: "19:30",
            arrival: "04:35",
            days: "Daily"
          },
          {
            trainNumber: "22436",
            trainName: "Vande Bharat Express",
            from: "NDLS",
            to: "BPL",
            departure: "06:00",
            arrival: "13:30",
            days: "M W Th F Sa Su"
          },
          {
            trainNumber: "12626",
            trainName: "Kerala Superfast Express",
            from: "NDLS",
            to: "BPL",
            departure: "20:10",
            arrival: "03:20",
            days: "Daily"
          },
          {
            trainNumber: "12345",
            trainName: "UP Express",
            from: "LKO",
            to: "BSB",
            departure: "10:00",
            arrival: "16:30",
            days: "Daily"
          }
        ];

        await db.collection("trains").insertMany(trains);

        res.json({
          success: true,
          message: "5 trains MongoDB me save ho gayi 🚆"
        });

      } catch (error) {
        console.error(error);

        res.status(500).json({
          success: false,
          message: "Trains save nahi hui"
        });
      }
    });

    // Frontend ke saare trains MongoDB me save karne ke liye
    app.post("/api/trains/import", async (req, res) => {
      try {
        const trains = req.body.trains;

        if (!Array.isArray(trains) || trains.length === 0) {
          return res.status(400).json({
            success: false,
            message: "Train data nahi mila"
          });
        }

        const collection = db.collection("trains");

        // Purana train data hatao
        await collection.deleteMany({});

        // Saare naye trains save karo
        const result = await collection.insertMany(trains);

        res.json({
          success: true,
          message: "Saare trains MongoDB me save ho gaye 🚆",
          count: result.insertedCount
        });

      } catch (error) {
        console.error(error);

        res.status(500).json({
          success: false,
          message: "Trains import nahi hui"
        });
      }
    });

    // Train search - RailRadar API se
    app.get("/api/trains/search", async (req, res) => {
      try {
        const { from, to } = req.query;

        if (!from || !to) {
          return res.status(400).json({
            success: false,
            message: "From aur To station required hai"
          });
        }

        const url =
          `https://api.railradar.in/v1/trains/between/${encodeURIComponent(from)}/${encodeURIComponent(to)}`;

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${RAILRADAR_API_KEY}`
          }
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
          return res.status(response.status).json({
            success: false,
            message: data?.error?.message || "Real train data nahi mila"
          });
        }

        const trains = data.data.trains.map(item => ({
          number: item.train.number,
          name: item.train.name,
          from: data.data.from.code,
          to: data.data.to.code,
          departure: item.from?.departure || "N/A",
          arrival: item.to?.arrival || "N/A",
          duration: item.duration || "N/A",
          days: item.train.runDays || [],
          route: []
        }));

        res.json({
          success: true,
          count: trains.length,
          trains
        });

      } catch (error) {
        console.error("RailRadar Search Error:", error);

        res.status(500).json({
          success: false,
          message: "Real train data nahi aa paya"
        });
      }
    });

    // MongoDB me train routes add/update karne ke liye
    app.post("/api/trains/add-routes", async (req, res) => {
      try {
        const routes = req.body.routes;

        if (!Array.isArray(routes) || routes.length === 0) {
          return res.status(400).json({
            success: false,
            message: "Route data nahi mila"
          });
        }

        const collection = db.collection("trains");

        let updated = 0;

        for (const item of routes) {
          const result = await collection.updateOne(
            { number: item.trainNumber },
            { $set: { route: item.route } }
          );

          if (result.modifiedCount > 0) {
            updated++;
          }
        }

        res.json({
          success: true,
          message: "Train routes MongoDB me add ho gaye 🚆",
          updated: updated
        });

      } catch (error) {
        console.error("Route Update Error:", error);

        res.status(500).json({
          success: false,
          message: "Routes update nahi hue"
        });
      }
    });

    // Get all trains
    app.get("/api/trains", async (req, res) => {
      try {
        const trains = await db
          .collection("trains")
          .find()
          .toArray();

        res.json({
          success: true,
          count: trains.length,
          trains: trains
        });

      } catch (error) {
        console.error(error);

        res.status(500).json({
          success: false,
          message: "Trains data fetch nahi hua"
        });
      }
    });

    // Backend health check
    app.get("/api/health", (req, res) => {
      res.json({
        success: true,
        message: "RailExpress Backend + MongoDB is running 🚆"
      });
    });

    app.get("/api/stations", (req, res) => {
      res.json({
        success: true,
        stations: stations
      });
    });

    app.post("/api/ghost", async (req, res) => {
      try {
        const message = (req.body.message || "").trim();

        if (!message) {
          return res.status(400).json({
            success: false,
            message: "Question bhejo"
          });
        }

        let trainData = "";

        const routeMatch = message.match(
          /\b([A-Z]{2,5})\b\s*(?:to|se|→|-)\s*\b([A-Z]{2,5})\b/i
        );

        if (routeMatch) {
          const fromCode = routeMatch[1].toUpperCase();
          const toCode = routeMatch[2].toUpperCase();

          const allTrains = await db
            .collection("trains")
            .find()
            .toArray();

          const routeTrains = allTrains.filter(train => {
            if (train.from === fromCode && train.to === toCode) {
              return true;
            }

            if (Array.isArray(train.route)) {
              const fromIndex = train.route.findIndex(
                station =>
                  station === fromCode ||
                  station.code === fromCode
              );

              const toIndex = train.route.findIndex(
                station =>
                  station === toCode ||
                  station.code === toCode
              );

              return (
                fromIndex !== -1 &&
                toIndex !== -1 &&
                fromIndex < toIndex
              );
            }

            return false;
          });

          trainData += `
Actual trains available from ${fromCode} to ${toCode}:

${routeTrains
  .map(
    t => `
Train: ${t.number || t.trainNumber}
Name: ${t.name || t.trainName || "N/A"}
Departure: ${t.departure || "N/A"}
Arrival: ${t.arrival || "N/A"}
Days: ${t.days || "N/A"}
Route: ${
      Array.isArray(t.route)
        ? t.route.join(" → ")
        : "N/A"
    }
`
  )
  .join("\n")}
`;
        }

        const trainNumber =
          (message.match(/\b\d{4,5}\b/) || [])[0];

        if (trainNumber) {
          const train = await db
            .collection("trains")
            .findOne({
              $or: [
                { number: trainNumber },
                { trainNumber: trainNumber }
              ]
            });

          if (train) {
            trainData = `
Actual RailExpress database data:
Train Number: ${train.number || train.trainNumber}
Train Name: ${train.name || train.trainName || "N/A"}
From: ${train.from || "N/A"}
To: ${train.to || "N/A"}
Departure: ${train.departure || "N/A"}
Arrival: ${train.arrival || "N/A"}
Days: ${train.days || "N/A"}
Route: ${
              Array.isArray(train.route)
                ? train.route.join(" → ")
                : "Route unavailable"
            }
`;
          }
        }

        let response;

        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            response = await ai.models.generateContent({
              model: "gemini-3.8-flash",

              contents: [
                ...ghostHistory,
                {
                  role: "user",
                  parts: [
                    {
                      text:
                        message +
                        "\n\n" +
                        trainData
                    }
                  ]
                }
              ],

              config: {
                thinkingConfig: {
                  thinkingLevel: "low"
                },

                systemInstruction:
                 "You are Ghost, the AI assistant of RailExpress. Answer clearly and helpfully in simple Hindi/Hinglish. Never invent train timings or availability. For actual train information, use the RailExpress backend data when tools are provided. The current date is " +
                   new Date().toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "long",
                    year: "numeric"
                     }) +
                     ". When the user asks for today's date, always use this current date."
                }
            });

            ghostHistory.push(
              {
                role: "user",
                parts: [
                  {
                    text:
                      message +
                      "\n\n" +
                      trainData
                  }
                ]
              },

              {
                role: "model",
                parts: [
                  {
                    text: response.text
                  }
                ]
              }
            );

            break;

          } catch (error) {
            if (error.status !== 503 || attempt === 3) {
              throw error;
            }

            console.log(
              `Gemini 503 — retrying (${attempt}/3)...`
            );

            await new Promise(resolve =>
              setTimeout(resolve, attempt * 2000)
            );
          }
        }

        res.json({
          success: true,
          reply: response.text
        });

      } catch (error) {
        console.error("Ghost AI Error:", error);

        if (error.status === 429) {
          return res.status(429).json({
            success: false,
            message:
              "👻your today limit is time out thanx for using ghost "
          });
        }

        if (error.status === 503) {
          return res.status(503).json({
            success: false,
            message:
              "👻 Ghost AI server abhi busy hai. Thodi der baad dobara try karein."
          });
        }

        res.status(500).json({
          success: false,
          message: "Ghost AI response nahi de paya"
        });
      }
    });
    // ================= BOOKING API =================
app.post("/api/book", async (req, res) => {
  try {
    const booking = req.body;

    const result = await db.collection("bookings").insertOne({
      ...booking,
      createdAt: new Date()
    });

    res.json({
      success: true,
      message: "Booking MongoDB me save ho gayi 🚆",
      bookingId: result.insertedId
    });

  } catch (error) {
    console.error("Booking Error:", error);

    res.status(500).json({
      success: false,
      message: "Booking save nahi hui"
    });
  }
});
// ================= BOOKING API =================
app.post("/api/bookings", async (req, res) => {
  try {
    const data = req.body;

    if (!data || Object.keys(data).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Booking data nahi mila"
      });
    }

    // 10 digit unique PNR generate
    let pnr;

    do {
      pnr = String(
        Math.floor(1000000000 + Math.random() * 9000000000)
      );
    } while (
      await db.collection("bookings").findOne({ pnr: pnr })
    );

    // Complete booking object
    const booking = {
      pnr: pnr,

      trainNumber: data.trainNumber || "",
      trainName: data.trainName || "",

      from: data.from || "",
      to: data.to || "",

      journeyDate: data.journeyDate || "",

      passengerName: data.passengerName || "",
      passengerAge: data.passengerAge || "",
      passengerGender: data.passengerGender || "",

      travelClass: data.travelClass || "",

      coach: data.coach || "",
      seat: data.seat || "",

      fare: Number(data.fare || 0),

      status: "CONFIRMED",

      createdAt: new Date()
    };

    // MongoDB me save
    const result = await db
      .collection("bookings")
      .insertOne(booking);

    // Frontend ko complete booking bhejo
    res.json({
      success: true,
      message: "Booking successfully MongoDB me save ho gayi 🚆",
      bookingId: result.insertedId,
      booking: booking
    });

  } catch (error) {
    console.error("Booking API Error:", error);

    res.status(500).json({
      success: false,
      message: "Booking save nahi hui"
    });
  }
});
    app.listen(PORT, () => {
      console.log(
        `RailExpress Backend running on http://localhost:${PORT}`
      );
    });

  } catch (error) {
    console.error("MongoDB Connection Failed ❌");
    console.error(error);
  }
}

startServer();