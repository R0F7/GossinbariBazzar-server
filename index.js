const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");

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

//middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

//verify Token middleware
// const verifyToken = async (req, res, next) => {
//   const token = req.cookie?.token;
// };

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
      const result = await productsCollection.find().toArray();
      res.send(result);
    });

    //single product
    app.get("/product/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await productsCollection.findOne(query);
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

app.listen(port, () => {
  console.log(`GossainbariBazzer listening on port: ${port} `);
});
