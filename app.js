import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();
import cors from "cors";
import jobRoutes from "./routes/jobRoutes.js";
import resumeRoutes from "./routes/resumeRoutes.js";


const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log(err));
console.log("MOngodb connection done")
app.use("/api/jobs", jobRoutes);
app.use("/api/resumes", resumeRoutes);

app.listen(5000, () => console.log("Server running on http://localhost:5000"));

