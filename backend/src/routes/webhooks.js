import { Router } from 'express';
import { asyncHandler } from '../utils/http.js';
import { processWebhook } from '../services/orders.js';

const router = Router();

// Register https://<your-host>/api/webhooks/paypal in the PayPal developer dashboard and subscribe to
// PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.DENIED, PAYMENT.CAPTURE.REFUNDED, PAYMENT.CAPTURE.REVERSED.
router.post('/paypal', asyncHandler(async (req, res) => {
  const status = await processWebhook(req.headers, req.body);
  res.status(200).json({ status });
}));

export default router;
