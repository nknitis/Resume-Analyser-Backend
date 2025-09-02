import express from "express";
import multer from "multer";
import { uploadResumes, getAllCandidates, getTopCandidates } from "../controllers/resumeController.js";
// import {  getAllCandidates, getTopCandidates } from "../controllers/resumeController.js";

const upload = multer({ dest: "uploads/" });
const router = express.Router();

router.post("/upload", upload.array("resumes"), uploadResumes);
router.get("/candidates/:jobId", getAllCandidates);
router.get("/top-candidates", getTopCandidates);

export default router;
