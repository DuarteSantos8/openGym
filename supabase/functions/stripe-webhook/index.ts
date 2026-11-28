// Supabase Edge Function "stripe-webhook": see ../_shared/handlers.js for what it does and
// supabase/tests/handlers.test.mjs for every path it takes.
import { stripeWebhook } from '../_shared/handlers.js'

Deno.serve(req => stripeWebhook(req, Deno.env.toObject(), fetch))
