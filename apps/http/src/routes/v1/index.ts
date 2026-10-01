import { Router } from "express";

export const router = Router();

router.post("/signin", (req, res) => {
    res.json({ message: "Sign-in route" });
});

router.post("/signup", (req, res) => {
    res.json({ message: "Sign-up route" });
});