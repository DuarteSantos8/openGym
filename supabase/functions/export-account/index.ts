// Supabase Edge Function "export-account": see ../_shared/account.js for what it does and
// supabase/tests/handlers.test.mjs for every path it takes.
import { exportAccount } from '../_shared/account.js'

Deno.serve(req => exportAccount(req, Deno.env.toObject(), fetch))
