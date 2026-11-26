// The Cloud edition's Edge Functions (supabase/functions, ADR 0010 and 0011) are plain modules
// with their own tests under supabase/tests. Importing those here runs them with the API's
// suite, so CI covers them without a second job: `cd api && npm test`.
import '../../supabase/tests/shared.test.mjs'
import '../../supabase/tests/handlers.test.mjs'
