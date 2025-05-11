const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { Server } = require("socket.io");
const http = require("http");
const server = http.createServer(app);
const admin = require("firebase-admin");
admin.initializeApp();

const port = process.env.PORT || 7777;

const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174"],
  credentials: true,
  optionSuccessStatus: 200,
};

//cookieOption
const cookieOption = {
  httpOnly: true,
  sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
  secure: process.env.NODE_ENV === "production",
};

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:5174"],
    methods: ["GET", "POST"],
  },
});

//middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

//verify Token middleware
const verifyToken = async (req, res, next) => {
  // console.log("Cookies received:", req.cookies);

  const token = req.cookies?.token;
  // console.log(token);

  if (!token) {
    return res.status(401).json({ message: "unauthorized access" });
  }

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wezoknx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("GossainbariBazzer");

    const usersCollection = db.collection("users");
    const productsCollection = db.collection("products");
    const reviewsCollection = db.collection("reviews");
    const cartProducts = db.collection("cart");
    const wishlistProduct = db.collection("wishlist");
    const orderCollection = db.collection("order");
    const messagesCollection = db.collection("messages");
    const notifications = db.collection("notifications");

    //auth related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });

      res
        // .cookie("token", token, {
        //   httpOnly: true,
        //   secure: process.env.NODE_ENV === "production" ? true : false,
        //   sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        // })
        .cookie("token", token, cookieOption)
        .send({ success: true });
    });

    app.get("/logout", async (req, res) => {
      res
        .clearCookie("token", { ...cookieOption, maxAge: 0 })
        .send({ success: true });
    });

    // payment route
    app.post("/create-payment-intent", async (req, res) => {
      const { total_price } = req.body;
      const total_price_in_cent = parseFloat(total_price) * 100;

      if (!total_price || total_price_in_cent < 1) return;

      // Create a PaymentIntent with the order amount and currency
      const { client_secret } = await stripe.paymentIntents.create({
        amount: total_price_in_cent,
        currency: "usd",
        automatic_payment_methods: {
          enabled: true,
        },
      });

      res.send({ clientSecret: client_secret });
    });

    //get all user
    app.get("/users", async (req, res) => {
      const result = await usersCollection.find().toArray();
      return res.send(result);
    });

    //get specific user
    app.get("/user/:email", async (req, res) => {
      const { email } = req.params;
      // console.log(email);
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      return res.send(result);
    });

    //save a user data in db
    app.put("/user", async (req, res) => {
      const user = req.body;
      const query = { email: user?.email };

      // check if user already exists in db
      const isExist = await usersCollection.findOne(query);

      if (isExist) {
        if (user.status === "Requested") {
          // if existing user try to change his role
          const result = await usersCollection.updateOne(query, {
            $set: { status: user?.status },
          });
          return res.send(result);
        } else {
          // if existing user login again
          return res.send(isExist);
        }
      }

      // save user for the first time
      const options = { upsert: true };
      const updateDoc = {
        $set: { ...user, timestamp: Date.now() },
      };
      const result = await usersCollection.updateOne(query, updateDoc, options);
      res.send(result);
    });

    //update user data in db
    app.patch("/user/:id", async (req, res) => {
      const id = req.params.id;
      const { name, phone_number, address } = req.body;
      const filter = { _id: new ObjectId(id) };
      // console.log(req.body);

      const updateDoc = {
        // $set: {
        //   ...(req.body.name && { name: req.body.name }),
        //   ...(req.body.phone_number && { number: req.body.phone_number }),
        //   ...(req.body.address && { address: req.body.address }),
        // },

        $set: {
          ...(name && { name }),
          ...(phone_number && { number: phone_number }),
          ...(address && { address }),
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    //all products
    app.get("/products", async (req, res) => {
      const { category, price, sub_category, tag } = req.query;
      // console.log(category, price, sub_category, tag);

      let filters = {};
      if (category) filters.category = category;
      if (price > 0) filters.price = { $lt: Number(price) };
      if (sub_category) filters.sub_category = sub_category;
      if (tag) filters.tags = { $in: [tag] };

      const result = await productsCollection.find(filters).toArray();
      res.send(result);
    });

    // post and update product
    app.put("/product", async (req, res) => {
      const product_info = req.body;
      const { _id, ...updateData } = product_info;

      const query = { _id: new ObjectId(_id) };

      const isExist = await productsCollection.findOne(query);
      if (isExist) {
        const result = await productsCollection.updateOne(query, {
          $set: { ...updateData, timestamp: Date.now() },
        });

        return res.send(result);
      }

      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...product_info,
          timestamp: Date.now(),
        },
      };

      const result = await productsCollection.updateOne(
        query,
        updateDoc,
        options
      );
      res.send(result);
    });

    //single product
    app.get("/product/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await productsCollection.findOne(query);
      res.send(result);
    });

    // get vendor product
    app.get("/vendor-products/:email", async (req, res) => {
      const { email } = req.params;
      // console.log(email);
      const query = { "vendor_info.email": email };
      const result = await productsCollection.find(query).toArray();
      res.send(result);
    });

    //save review in db
    app.post("/review", async (req, res) => {
      const review_info = req.body;
      const result = await reviewsCollection.insertOne(review_info);
      res.send(result);
    });

    //get specific reviews
    app.get("/reviews/:id", async (req, res) => {
      const { id } = req.params;
      const query = { product_id: id };
      const result = await reviewsCollection.find(query).toArray();
      res.send(result);
    });

    //get all reviews
    app.get("/reviews", async (req, res) => {
      const result = await reviewsCollection.find().toArray();
      res.send(result);
    });

    //add product in card
    app.put("/add-product-in-cart", async (req, res) => {
      const product_info = req.body;
      // console.log(product_info.order_owner_info.email);

      const query = {
        id: product_info.id,
        "order_owner_info.email": product_info.order_owner_info.email,
      };

      const isExist = await cartProducts.findOne(query);
      if (isExist) {
        const result = await cartProducts.updateOne(query, {
          $set: { quantity: product_info.quantity, timestamp: Date.now() },
        });

        return res.send(result);
      }

      const options = { upsert: true };
      const updateDoc = {
        $set: { ...product_info, timestamp: Date.now() },
      };
      const result = await cartProducts.updateOne(query, updateDoc, options);
      res.send(result);
    });

    //get active user card product
    app.get("/products-in-cart/:email", async (req, res) => {
      const { email } = req.params;
      const query = { "order_owner_info.email": email };
      const result = await cartProducts.find(query).toArray();
      res.send(result);
    });

    //delete-product-in-cart
    app.delete("/delete-product-in-cart", async (req, res) => {
      const product_info = req.body;
      const filter = {
        id: product_info.id,
        "order_owner_info.email": product_info.order_owner_info.email,
      };
      // console.log(filter);
      const result = await cartProducts.deleteOne(filter);
      res.send(result);
    });

    // add product in wishlist
    app.post("/add-product-wishlist", async (req, res) => {
      const product_info = req.body;
      const filter = { id: product_info.id, email: product_info.email };

      const wishlist = await wishlistProduct.find(filter).toArray();
      if (wishlist && wishlist.length > 0) {
        return;
      }

      const result = await wishlistProduct.insertOne(product_info);
      res.send(result);
    });

    // get product in wishlist
    app.get("/wishlist/:email", verifyToken, async (req, res) => {
      const { email } = req.params;

      const allProducts = await productsCollection.find().toArray();
      const wishlistProducts = await wishlistProduct
        .find({ email: email })
        .toArray();

      // Filter products that exist in the wishlist
      const filteredProducts = allProducts.filter((product) =>
        wishlistProducts.some(
          (wishlistItem) =>
            product._id.toString() === wishlistItem.id.toString()
        )
      );

      res.send(filteredProducts);
    });

    // delete wishlist data
    app.delete("/wishlist", verifyToken, async (req, res) => {
      const info = req.body;
      const query = { id: info.id, email: info.email };
      // console.log(query);
      const result = await wishlistProduct.deleteOne(query);
      // console.log(result);
      res.send(result);
    });

    // place order & remove cart items & update card product quantity
    app.post("/order-info", async (req, res) => {
      const data = req.body;
      const { email } = data.order_owner_info;

      if (
        !data.products ||
        !Array.isArray(data.products) ||
        data.products.length === 0
      ) {
        return res
          .status(400)
          .json({ message: "Invalid or empty product data" });
      }

      // Delete cart items
      await cartProducts.deleteMany({ "order_owner_info.email": email });

      // Update product stock
      const bulkOperations = [];

      for (const product of data.products) {
        const productId = new ObjectId(product.id);
        const quantity = parseInt(product.quantity);

        if (isNaN(quantity) || quantity <= 0) {
          return res
            .status(400)
            .json({ message: `Invalid quantity for product: ${product.id}` });
        }

        bulkOperations.push({
          updateOne: {
            filter: { _id: productId },
            update: { $inc: { total_product: -quantity } },
          },
        });
      }

      if (bulkOperations.length > 0)
        await productsCollection.bulkWrite(bulkOperations);

      // Insert the order
      const orderResult = await orderCollection.insertOne(data);
      res.send(orderResult);
    });

    // get specific user order data
    app.get("/order-data/:email", async (req, res) => {
      const { email } = req.params;
      const { startDate, endDate } = req.query;
      let query = { "order_owner_info.email": email };

      if (
        startDate &&
        endDate &&
        startDate !== "undefined" &&
        endDate !== "undefined"
      ) {
        const start = new Date(startDate);
        const end = new Date(endDate);

        query = {
          ...query,
          createdAt: { $gte: start, $lte: end },
        };
      }

      const result = await orderCollection
        .aggregate([
          { $addFields: { createdAt: { $toDate: "$createdAt" } } },
          { $match: query },
          { $sort: { createdAt: -1 } },
        ])
        .toArray();
      res.send(result);
    });

    app.get("/order-details/:id", async (req, res) => {
      const { id } = req.params;

      const orderData = await orderCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(orderData);
    });

    // // get ordered data for specific vendor
    // app.get("/orders-receive/:email", async (req, res) => {
    //   const { email } = req.params;
    //   const orders = await orderCollection
    //     .find({
    //       products: {
    //         $elemMatch: {
    //           "vendor_info.email": email,
    //         },
    //       },
    //     })
    //     .toArray();
    //   res.send(orders);
    // });

    // order receive for vendor by email
    app.get("/orders-receive/:email", async (req, res) => {
      const { email } = req.params;
      const { startDate, endDate, search } = req.query;

      const query = {
        "products.vendor_info.email": email,
      };

      if (
        startDate &&
        endDate &&
        startDate !== "undefined" &&
        endDate !== "undefined"
      ) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        query.createdAt = { $gte: start, $lte: end };
      }

      if (search && search !== "null") {
        const searchRegex = new RegExp(search, "i");
        query.$or = [
          { orderID: searchRegex },
          { "shippingDetails.trackingNumber": searchRegex },
        ];
      }

      try {
        const orders = await orderCollection
          .aggregate([
            // Convert createdAt to Date object
            { $addFields: { createdAt: { $toDate: "$createdAt" } } },

            // Match vendor email and optional date range
            { $match: query },

            // Sort by latest order first
            { $sort: { createdAt: -1 } },

            // Project only needed fields and filter products by vendor
            {
              $project: {
                orderID: 1,
                shippingDetails: 1,
                paymentInfo: 1,
                order_owner_info: 1,
                total_price: 1,
                total_quantity: 1,
                status: 1,
                createdAt: 1,
                delivery: 1,
                vendor_status: 1,
                products: {
                  $filter: {
                    input: "$products",
                    as: "product",
                    cond: {
                      $eq: ["$$product.vendor_info.email", email],
                    },
                  },
                },
              },
            },
          ])
          .toArray();

        res.send(orders);
      } catch (err) {
        res.status(500).send({ error: "Server Error", details: err.message });
      }
    });

    // order_update_vendor_status
    app.patch("/order_update_vendor_status/:id", async (req, res) => {
      const { id } = req.params;
      const { vendor_status } = req.body;

      if (!vendor_status?.email || !vendor_status?.status) {
        return res.status(400).json({ message: "Invalid vendor status data." });
      }

      // Add/update the createdAt timestamp
      const currentTimestamp = new Date();
      vendor_status.createdAt = currentTimestamp;

      try {
        const updated = await orderCollection.updateOne(
          { _id: new ObjectId(id), "vendor_status.email": vendor_status.email },
          {
            $set: {
              "vendor_status.$.status": vendor_status.status,
              "vendor_status.$.createdAt": currentTimestamp,
            },
          }
        );

        if (updated.modifiedCount === 0) {
          console.log("Pushing new vendor_status...");
          await orderCollection.updateOne(
            { _id: new ObjectId(id) },
            { $push: { vendor_status: vendor_status } }
          );
        }

        res.json({ message: "Vendor status updated successfully" });
      } catch (error) {
        console.error("Update error:", error);
        res
          .status(500)
          .json({ message: "Update failed", error: error.message });
      }
    });

    // order shipping status update
    app.patch("/shipping-status-update/:id", async (req, res) => {
      const { id } = req.params;
      const { newStatus } = req.body;

      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { "shippingDetails.status": newStatus },
      };

      const updated = await orderCollection.updateOne(query, updateDoc);
      res.send(updated);
    });

    // live chat
    io.on("connection", (socket) => {
      // console.log("User connected:", socket.id);

      // User joins chat room
      socket.on("joinChat", (email) => {
        socket.join(email);
        // console.log(`${email} joined chat room`);
      });

      // Load previous messages when user joins
      socket.on("loadMessages", async (email) => {
        const chatHistory = await messagesCollection.find({ email }).toArray();
        socket.emit("previousMessages", chatHistory);
      });

      // Handle new message
      socket.on("sendMessage", async (data) => {
        const { email, userType, text } = data;
        const newMessage = {
          email,
          userType,
          text,
          timestamp: new Date(),
        };

        // Save message to DB
        await messagesCollection.insertOne(newMessage);

        // Emit message to the corresponding user
        io.to(email).emit("receiveMessage", newMessage);
      });

      // User disconnect
      socket.on("disconnect", () => {
        // console.log("User disconnected:", socket.id);
      });
    });

    // //live chat (firebase)
    // const setAdminRole = async (uid) => {
    //   await admin.auth().setCustomUserClaims(uid, { admin: true });
    //   console.log("Admin role assigned to user");
    // };

    // get notifications
    app.get("/notifications/:email", async (req, res) => {
      const { email } = req.params;
      const result = await notifications.find({ email: email }).toArray();
      res.send(result);
    });

    // post notifications
    app.post("/notification", async (req, res) => {
      const data = req.body;
      const result = await notifications.insertOne(data);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("GossainbariBazzer server is running");
});

// app.listen(port, () => {
//   console.log(`GossainbariBazzer listening on port: ${port} `);
// });

server.listen(port, () => {
  console.log(`GossainbariBazzer listening on port: ${port} `);
});
