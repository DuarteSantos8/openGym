// Run from frontend: node scripts/health-connect-coverage.mjs
import { mappingCoverage } from '../src/lib/health-connect-mapping.js'
const { unknownExercises, ...counts } = mappingCoverage()
console.log(JSON.stringify(counts, null, 2))
console.log('UNKNOWN exercises:', unknownExercises.length ? unknownExercises : 'none')
