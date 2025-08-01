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
const cron = require("node-cron");
const port = process.env.PORT || 7777;
// admin.initializeApp();

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

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});

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
    const payoutCollection = db.collection("payout");
    const categoryCollection = db.collection("categories");
    const blogsCollection = db.collection("blogs");

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
      const { role } = req.query;
      // console.log(role);

      const query = {};

      if (role) query.role = role;

      const result = await usersCollection.find(query).toArray();
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
      const { name, phone_number, address, action, vendor_info } = req.body;
      const filter = { _id: new ObjectId(id) };
      const status = vendor_info?.status;
      delete vendor_info?.status;

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
          ...(action && { action }),
          ...(vendor_info && { vendor_info, status }),
        },
      };

      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.patch("/user-role/:email", async (req, res) => {
      const { email } = req.params;
      const { role, status } = req.body;
      // console.log(role, status);

      const filter = { email: email };
      const updateDoc = {
        $set: {
          ...(role && { role }),
          ...(status && { status }),
        },
      };

      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // DELETE user by email
    app.delete("/delete-user-by-email/:email", async (req, res) => {
      const email = req.params.email;

      try {
        // First, get the user's UID by email
        const userRecord = await admin.auth().getUserByEmail(email);
        const uid = userRecord.uid;

        // Then delete the user by UID
        await admin.auth().deleteUser(uid);
        await usersCollection.deleteOne({ email: email });

        res
          .status(200)
          .json({ message: `User with email ${email} deleted successfully.` });
      } catch (error) {
        console.error("Error deleting user:", error.message);
        res
          .status(500)
          .json({ error: "Failed to delete user. " + error.message });
      }
    });

    //all products
    app.get("/products", async (req, res) => {
      const {
        category,
        minPrice,
        maxPrice,
        sub_category,
        tag,
        searchText,
        sortOption,
        status,
      } = req.query;
      // console.log(category, price, sub_category, tag);
      // console.log(minPrice, maxPrice);
      console.log(status);

      let filters = {};
      let sort = {};

      if (category) filters.category = category;
      if (sub_category) filters.sub_category = sub_category;
      if (tag) filters.tags = { $in: [tag] };
      if (status) filters.status = status;
      if (searchText && searchText.trim() !== "") {
        filters.title = { $regex: new RegExp(searchText, "i") };
      }

      if (
        minPrice !== undefined &&
        maxPrice !== undefined &&
        maxPrice !== "0"
      ) {
        filters.price = { $gte: Number(minPrice), $lte: Number(maxPrice) };
      }

      if (sortOption) {
        if (sortOption === "default") {
          sort.timestamp = 1;
        } else if (sortOption === "latest") {
          sort.timestamp = -1;
        } else if (sortOption === "low-to-high") {
          sort.price = 1;
        } else if (sortOption === "high-to-low") {
          sort.price = -1;
        } else if (sortOption === "rating") {
          sort.rating = -1;
        } else if (sortOption === "popularity") {
          sort.sold_product = -1;
        }
      }

      const result = await productsCollection
        .find(filters)
        .sort(sort)
        .toArray();
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
          $set: { ...updateData, updatedTime: Date.now() },
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

    app.delete("/product/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await productsCollection.deleteOne(query);
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
    // app.get("/orders-receive/:email", async (req, res) => {
    //   const { email } = req.params;
    //   const { startDate, endDate, search, minPrice, maxPrice } = req.query;
    //   console.log(minPrice, maxPrice);

    //   const query = {
    //     "products.vendor_info.email": email,
    //     // status: "Delivered",
    //   };

    //   if (
    //     startDate &&
    //     endDate &&
    //     startDate !== "undefined" &&
    //     endDate !== "undefined"
    //   ) {
    //     const start = new Date(startDate);
    //     const end = new Date(endDate);
    //     query.createdAt = { $gte: start, $lte: end };
    //   }

    //   if (search && search !== "null") {
    //     const searchRegex = new RegExp(search, "i");
    //     query.$or = [
    //       { orderID: searchRegex },
    //       { "shippingDetails.trackingNumber": searchRegex },
    //       { returns: { $elemMatch: { requestID: searchRegex } } },
    //     ];
    //   }

    //   try {
    //     const orders = await orderCollection
    //       .aggregate([
    //         // Convert createdAt to Date object
    //         { $addFields: { createdAt: { $toDate: "$createdAt" } } },

    //         // Match vendor email and optional date range
    //         { $match: query },

    //         // Sort by latest order first
    //         { $sort: { createdAt: -1 } },

    //         // Project only needed fields and filter products by vendor
    //         {
    //           $project: {
    //             orderID: 1,
    //             shippingDetails: 1,
    //             paymentInfo: 1,
    //             order_owner_info: 1,
    //             total_price: 1,
    //             total_quantity: 1,
    //             status: 1,
    //             createdAt: 1,
    //             delivery: 1,
    //             vendor_status: 1,
    //             discounted_price: 1,
    //             returns: 1,
    //             products: {
    //               $filter: {
    //                 input: "$products",
    //                 as: "product",
    //                 cond: {
    //                   $eq: ["$$product.vendor_info.email", email],
    //                 },
    //               },
    //             },
    //           },
    //         },
    //       ])
    //       .toArray();

    //     res.send(orders);
    //   } catch (err) {
    //     res.status(500).send({ error: "Server Error", details: err.message });
    //   }
    // });

    app.get("/orders-receive/:email", async (req, res) => {
      const { email } = req.params;
      console.log(email);
      const {
        startDate,
        endDate,
        search,
        minPrice,
        maxPrice,
        category,
        revenueCalculation,
      } = req.query;

      const query = {
        "products.vendor_info.email": email,
      };

      if (revenueCalculation) {
        query.status = "Delivered";
      }

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

      if (category && category !== "undefined") {
        query["products.category"] = category;
      }

      if (search && search !== "null") {
        const searchRegex = new RegExp(search, "i");
        query.$or = [
          { orderID: searchRegex },
          { "shippingDetails.trackingNumber": searchRegex },
          { returns: { $elemMatch: { requestID: searchRegex } } },
        ];
      }

      try {
        const orders = await orderCollection
          .aggregate([
            { $addFields: { createdAt: { $toDate: "$createdAt" } } },
            { $match: query },
            { $sort: { createdAt: -1 } },
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
                discounted_price: 1,
                returns: 1,
                products: {
                  $filter: {
                    input: "$products",
                    as: "product",
                    cond: {
                      $and: [
                        { $eq: ["$$product.vendor_info.email", email] },
                        ...(minPrice !== undefined &&
                        maxPrice !== undefined &&
                        maxPrice !== "0"
                          ? [
                              { $gte: ["$$product.price", Number(minPrice)] },
                              { $lte: ["$$product.price", Number(maxPrice)] },
                            ]
                          : []),
                        ...(category
                          ? [{ $eq: ["$$product.category", category] }]
                          : []),
                      ],
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

    // all order
    app.get("/order-for-admin", async (req, res) => {
      const { status, searchTerm } = req.query;
      const query = {};

      if (status) {
        query.status = status;
      }

      if (searchTerm?.trim() && searchTerm !== "null") {
        const regex = new RegExp(searchTerm, "i");
        query.$or = [
          { orderID: regex },
          { "shippingDetails.trackingNumber": regex },
        ];
      }

      const result = await orderCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
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
          // console.log("Pushing new vendor_status...");
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

    // order status update
    app.patch("/order-status-update/:id", async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = { $set: { status: status } };

      const result = await orderCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // return orders
    app.get("/return-orders", async (req, res) => {
      // const { email } = req.params;

      const query = {
        // "products.vendor_info.email": email,
        returns: { $exists: true, $ne: [] },
      };

      const projection = {
        returns: 1,
        order_owner_info: 1,
        paymentInfo: 1,
        _id: 0,
      };

      const returnedItems = await orderCollection
        .find(query)
        .project(projection)
        .toArray();

      const allReturns = returnedItems.flatMap((order) =>
        order.returns.map((info) => ({
          ...info,
          order_owner_info: order.order_owner_info,
          paymentInfo: order.paymentInfo,
        }))
      );

      res.send(allReturns);
    });

    // refund payment
    app.post("/refund", async (req, res) => {
      const { info } = req.body;
      const { requestID, orderID, amount, transactionId, status } = info;

      if (amount < 0 || status !== "Approved") return;

      try {
        const refund = await stripe.refunds.create({
          payment_intent: transactionId,
          ...(amount && { amount: Math.round(amount * 100) }),
        });

        const order = await orderCollection.updateOne(
          { orderID, "returns.requestID": requestID },
          {
            $set: {
              "returns.$.status": "Completed",
              "returns.$.paymentStatus": "Paid",
            },
          }
        );

        res.send({ success: true });
      } catch (err) {
        console.error("Refund Error:", err.message);
        res.status(500).send({ success: false, message: err.message });
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

    //return_order_info
    app.patch("/return-order-info/:id", async (req, res) => {
      const { id } = req.params;
      const { email } = req.query;
      const { returns } = req.body;

      if (!returns || !email || !id) {
        return res.status(400).json({ message: "Invalid or missing data." });
      }

      const query = { orderID: id, "order_owner_info.email": email };

      const currentTimestamp = new Date();
      returns.requestedOn = currentTimestamp;

      try {
        const result = await orderCollection.updateOne(query, {
          $push: { returns: returns },
        });
        res.send(result);
      } catch (error) {
        console.error("Update error:", error);
        res
          .status(500)
          .json({ message: "Update failed", error: error.message });
      }
    });

    //return order status update
    app.patch("/update-return-status/:requestID/:orderID", async (req, res) => {
      const { requestID, orderID } = req.params;
      const { newStatus } = req.body;

      const result = await orderCollection.updateOne(
        { orderID, "returns.requestID": requestID },
        { $set: { "returns.$.status": newStatus } }
      );
      res.send(result);
    });

    // get all payout
    app.get("/payout", async (req, res) => {
      const result = await payoutCollection.find().toArray();
      res.send(result);
    });

    // get payout
    app.get("/payout/:email", async (req, res) => {
      const { email } = req.params;
      const result = await payoutCollection
        .find({ vendorEmail: email })
        .toArray();
      res.send(result);
    });

    // Route: Create Express Account for Vendor
    app.post("/create-stripe-account", async (req, res) => {
      const { email, vendor_name, bank_account } = req.body;

      try {
        // 1. Create Stripe Express Account
        const account = await stripe.accounts.create({
          type: "express",
          email,
          capabilities: { transfers: { requested: true } },
        });

        // 2. Create onboarding link
        const accountLink = await stripe.accountLinks.create({
          account: account.id,
          refresh_url: "http://localhost:5173",
          return_url: "http://localhost:5173",
          type: "account_onboarding",
        });

        // 3. Prepare full vendor_info object
        const vendor_info = {
          vendor_name,
          bank_account,
          stripe_account_id: account.id,
          requestedAt: new Date(),
        };

        // console.log("vendor_info to update:", vendor_info);

        // 4. Update user with full vendor_info
        const updateRes = await usersCollection.updateOne(
          { email },
          {
            $set: {
              vendor_info,
              status: "Requested",
            },
          }
        );

        // console.log("User update result:", updateRes);

        // 5. Return Stripe onboarding URL
        res.send({ url: accountLink.url });
      } catch (error) {
        console.error("Stripe error:", error);
        res.status(500).send({ error: error.message });
      }
    });

    // app.get("/test-payout", async (req, res) => {
    //   try {
    //     await generateMonthlyPayouts();
    //     res.send("Payout test completed");
    //   } catch (err) {
    //     console.error(err);
    //     res.status(500).send("Error");
    //   }
    // });

    // প্রতি মিনিটে test করার জন্য:
    // cron.schedule("* * * * *", async () => {
    //   console.log("⏱️ Cron running for test...");
    // });
    // await generateMonthlyPayouts();

    cron.schedule(
      "0 10 1 * *",
      async () => {
        await generateMonthlyPayouts();
      },
      {
        timezone: "Asia/Dhaka",
      }
    );

    // base current month
    // async function generateMonthlyPayouts() {
    //   const vendors = await usersCollection.find({ role: "seller" }).toArray();
    //   // console.log("vendors", vendors);

    //   const currentMonth = new Date().getMonth();
    //   const currentYear = new Date().getFullYear();

    //   // Start and end of current month
    //   const startOfMonth = new Date(currentYear, currentMonth, 1);
    //   const endOfMonth = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59);

    //   for (const vendor of vendors) {
    //     // Check if payout already exists for this vendor in current month
    //     const alreadyExists = await payoutCollection.findOne({
    //       vendorEmail: vendor.email,
    //       payoutDate: {
    //         $gte: new Date(currentYear, currentMonth, 1),
    //         $lte: new Date(currentYear, currentMonth + 1, 0),
    //       },
    //     });

    //     console.log("alreadyExists", alreadyExists);
    //     if (alreadyExists) continue; // skip if already paid or pending

    //     // Calculate payout amount from orders
    //     // Filter only current month's delivered products
    //     // console.log(vendor.email);
    //     const startISO = startOfMonth.toISOString();
    //     const endISO = endOfMonth.toISOString();

    //     const orders = await orderCollection
    //       .find({
    //         status: "Delivered",
    //         "shippingDetails.shippedDate": {
    //           $gte: startISO,
    //           $lte: endISO,
    //         },
    //         products: {
    //           $elemMatch: {
    //             "vendor_info.email": vendor.email,
    //           },
    //         },
    //       })
    //       .toArray();

    //     // console.log("orders", orders);
    //     const totalAmount = calculateVendorEarning(orders, vendor.email);
    //     // console.log("totalAmount",totalAmount);

    //     if (totalAmount === 0) continue;

    //     const newPayout = {
    //       vendorEmail: vendor.email,
    //       amount: totalAmount,
    //       status: "Pending",
    //       method: "Bank Transfer",
    //       // transactionId: generateTrxId(), // helper function
    //       payoutDate: new Date(currentYear, currentMonth, 7, 10, 0, 0),
    //       note: `Monthly payout for ${getMonthName(currentMonth)}`,
    //       bankAccount: vendor.vendor_info.bank_account || "Not Provided",
    //     };

    //     await payoutCollection.insertOne(newPayout);
    //   }
    // }

    // base last month
    async function generateMonthlyPayouts() {
      const vendors = await usersCollection.find({ role: "seller" }).toArray();

      const now = new Date();
      const lastMonth = now.getMonth() - 1;
      const yearOfLastMonth =
        lastMonth < 0 ? now.getFullYear() - 1 : now.getFullYear();
      const monthIndex = (lastMonth + 12) % 12;

      const startOfLastMonth = new Date(yearOfLastMonth, monthIndex, 1);
      const endOfLastMonth = new Date(
        yearOfLastMonth,
        monthIndex + 1,
        0,
        23,
        59,
        59
      );

      for (const vendor of vendors) {
        // Check if payout already exists for this vendor for that last month
        const alreadyExists = await payoutCollection.findOne({
          vendorEmail: vendor.email,
          payoutDate: {
            $gte: new Date(now.getFullYear(), now.getMonth(), 7, 0, 0, 0),
            $lte: new Date(now.getFullYear(), now.getMonth(), 7, 23, 59, 59),
          },
          note: `Monthly payout for ${getMonthName(monthIndex)}`,
        });

        if (alreadyExists) continue; // Skip if payout already generated

        // Get orders that were delivered in last month and belong to this vendor
        const orders = await orderCollection
          .find({
            status: "Delivered",
            "shippingDetails.shippedDate": {
              $gte: startOfLastMonth,
              $lte: endOfLastMonth,
            },
            products: {
              $elemMatch: {
                "vendor_info.email": vendor.email,
              },
            },
          })
          .toArray();

        const totalAmount = calculateVendorEarning(orders, vendor.email);

        if (totalAmount === 0) continue;

        const payoutDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          7,
          10,
          0,
          0
        ); // 7th day 10 AM

        const newPayout = {
          vendorEmail: vendor.email,
          amount: totalAmount,
          status: "Pending",
          method: "Bank Transfer",
          payoutDate,
          note: `Monthly payout for ${getMonthName(monthIndex)}`, // example: July
          bankAccount: vendor.vendor_info.bank_account || "Not Provided",
        };

        await payoutCollection.insertOne(newPayout);
        console.log(`Payout created for ${vendor.email} - $${totalAmount}`);
      }
    }

    function calculateVendorEarning(orders, vendorEmail) {
      let total = 0;
      for (const order of orders) {
        for (const product of order.products) {
          if (product.vendor_info.email === vendorEmail) {
            const price = product.discounted_price || product.price;
            total += price * product.quantity;
          }
        }
      }
      return total;
    }

    function getMonthName(index) {
      return [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ][index];
    }

    // Auto Payout on 7th day of every month at 10:00 AM
    // cron.schedule(
    //   "0 10 7 * *",
    //   async () => {
    //     console.log("Running vendor payout job");
    //     try {
    //       const vendors = await usersCollection
    //         .find({
    //           "vendor_info.stripe_account_id": { $exists: true },
    //         })
    //         .toArray();

    //       for (const vendor of vendors) {
    //         const stripeAccountId = vendor.vendor_info.stripe_account_id;

    //         // Calculate total payout (customize as needed)
    //         const payments = await payoutCollection
    //           .find({
    //             vendorEmail: vendor.email,
    //             status: { $ne: "Paid" },
    //           })
    //           .toArray();

    //         const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);

    //         if (totalAmount > 0) {
    //           const payout = await stripe.transfers.create({
    //             amount: Math.floor(totalAmount * 100), // cents
    //             currency: "usd",
    //             destination: stripeAccountId,
    //             description: `Monthly payout for ${vendor.email}`,
    //           });

    //           // Mark payments as paid
    //           const paymentIds = payments.map((p) => p._id);
    //           await payoutCollection.updateMany(
    //             { _id: { $in: paymentIds } },
    //             { $set: { status: "Paid", paidAt: new Date() } }
    //           );

    //           console.log(`Paid $${totalAmount} to ${vendor.email}`);
    //         }
    //       }
    //     } catch (error) {
    //       console.error("Payout error:", error);
    //     }
    //   },
    //   {
    //     timezone: "Asia/Dhaka",
    //   }
    // );

    // app.get("/test-vendor-payout", async (req, res) => {
    //   try {
    //     console.log("⏱️ Manual payout test started...");
    //     await runVendorPayout(); // cron এর ভিতরের function এখানে call করবে
    //     res.send("✅ Vendor payout test complete.");
    //   } catch (err) {
    //     console.error("❌ Payout test failed:", err);
    //     res.status(500).send("Error during payout test.");
    //   }
    // });

    cron.schedule(
      "0 10 7 * *",
      async () => {
        await runVendorPayout();
      },
      {
        timezone: "Asia/Dhaka",
      }
    );

    async function runVendorPayout() {
      const vendors = await usersCollection
        .find({ "vendor_info.stripe_account_id": { $exists: true } })
        .toArray();

      for (const vendor of vendors) {
        const stripeAccountId = vendor.vendor_info.stripe_account_id;
        // console.log("stripeAccountId",stripeAccountId);
        // console.log(vendor.email);
        const payments = await payoutCollection
          .find({ vendorEmail: vendor.email, status: { $ne: "Paid" } })
          .toArray();
        // console.log(payments);

        // const totalAmount =
        //   payments.reduce((sum, p) => sum + p.amount, 0) * 0.98;
        // // console.log(totalAmount);
        const grossAmount = payments.reduce((sum, p) => sum + p.amount, 0);
        const platformFee = grossAmount * 0.02;
        const totalAmount = grossAmount - platformFee;

        if (totalAmount > 0) {
          const payout = await stripe.transfers.create({
            amount: Math.floor(totalAmount * 100),
            currency: "usd",
            destination: stripeAccountId,
            description: `Monthly payout for ${vendor.email}`,
          });

          const paymentIds = payments.map((p) => p._id);
          await payoutCollection.updateMany(
            { _id: { $in: paymentIds } },
            { $set: { status: "Paid", paidAt: new Date() } }
          );

          // console.log(`✅ Paid $${totalAmount} to ${vendor.email}`);
        }
      }
    }

    // calculate revenue current to last month
    app.get("/revenue/:email", async (req, res) => {
      const { email } = req.params;
      const currentDate = new Date();

      const currentMonth = currentDate.getMonth();
      const currentYear = currentDate.getFullYear();

      const lastMonthDate = new Date(currentDate);
      lastMonthDate.setMonth(currentMonth - 1);

      const startOfCurrentMonth = new Date(currentYear, currentMonth, 1);
      const endOfCurrentMonth = new Date(currentYear, currentMonth + 1, 0);

      const startOfLastMonth = new Date(
        lastMonthDate.getFullYear(),
        lastMonthDate.getMonth(),
        1
      );
      const endOfLastMonth = new Date(
        lastMonthDate.getFullYear(),
        lastMonthDate.getMonth() + 1,
        0
      );

      const calculateRevenue = async (start, end) => {
        const result = await orderCollection
          .aggregate([
            { $addFields: { createdAt: { $toDate: "$createdAt" } } },
            {
              $match: {
                "products.vendor_info.email": email,
                status: "Delivered",
                createdAt: { $gte: start, $lte: end },
              },
            },
            { $unwind: "$products" },
            {
              $match: {
                "products.vendor_info.email": email,
              },
            },
            {
              $addFields: {
                actualPrice: {
                  $cond: [
                    { $gt: ["$products.discounted_price", 0] },
                    "$products.discounted_price",
                    "$products.price",
                  ],
                },
              },
            },
            {
              $group: {
                _id: null,
                totalRevenue: {
                  $sum: {
                    $multiply: ["$actualPrice", "$products.quantity"],
                  },
                },
              },
            },
          ])
          .toArray();

        return result[0]?.totalRevenue || 0;
      };

      const currentRevenue = await calculateRevenue(
        startOfCurrentMonth,
        endOfCurrentMonth
      );
      const lastRevenue = await calculateRevenue(
        startOfLastMonth,
        endOfLastMonth
      );

      const growthPercentage =
        lastRevenue === 0
          ? 100
          : (((currentRevenue - lastRevenue) / lastRevenue) * 100).toFixed(2);

      res.send({
        currentRevenue,
        lastRevenue,
        growthPercentage,
      });
    });

    // categories
    app.get("/categories", async (req, res) => {
      const result = await categoryCollection.find().toArray();
      res.send(result);
    });

    // patch category
    app.patch("/category", async (req, res) => {
      const { id, ...updateInfo } = req.body;

      if (Object.keys(updateInfo).length === 0) {
        return res.status(400).send({ error: "No data provided" });
      }

      const query = id ? { _id: new ObjectId(id) } : null;

      if (query) {
        const isExist = await categoryCollection.findOne(query);

        if (isExist) {
          const result = await categoryCollection.updateOne(query, {
            $set: { ...updateInfo, updatedTime: Date.now() },
          });
          return res.send(result);
        }
      }

      const { categoryName, icon, categoryImage } = updateInfo;

      if (!categoryName || !icon || !categoryImage) {
        return res.status(400).send({ error: "Incomplete category data" });
      }

      const updateDoc = {
        $set: { ...updateInfo, createdAt: Date.now() },
      };

      const result = await categoryCollection.updateOne(
        { categoryName },
        updateDoc,
        { upsert: true }
      );

      res.send(result);
    });

    // blog post
    app.post("/blog-post", async (req, res) => {
      const { info } = req.body;
      const result = await blogsCollection.insertOne({
        ...info,
        date: Date.now(),
      });

      res.send(result);
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
