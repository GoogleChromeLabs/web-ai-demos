import { Router, Request, Response } from 'express';
import { evalAll } from './eval.service';

export const router = Router();

router.post('/evaluate', async (req: Request, res: Response) => {
    try {
        const { data } = req.body;
        if (!data) {
            res.status(400).json({ error: 'Data payload is required' });
            return;
        }

        // Ensure data is always an array
        const itemsToEvaluate = Array.isArray(data) ? data : [data];
        const evaluationResults = await evalAll(itemsToEvaluate);
        res.json(evaluationResults);
    } catch (error: any) {
        console.error("Evaluation failed:", error);
        res.status(500).json({ error: error.message || "Internal Server Error" });
    }
});
