// Supabase Edge Function "delete-account": see ../_shared/account.js for what it does and
// supabase/tests/handlers.test.mjs for every path it takes.
import { deleteAccount } from '../_shared/account.js'

Deno.serve(req => deleteAccount(req, Deno.env.toObject(), fetch))
