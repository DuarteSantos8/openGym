/* The sources the Coach may cite: tag -> what it may use them for, and the studies behind it.
 * Copied from coAIch plugin/references/evidence.md (PMIDs and DOIs as verified there); a number no
 * study backs is graded 'our rule'. `use` has no names or years: it is what goes in the prompt. */
export const EVIDENCE = {
  volume: {
    use: 'more weekly sets help, with diminishing returns',
    sources: [
      { cite: 'Schoenfeld, Ogborn & Krieger 2017, *J Sports Sci* 35(11):1073–1082 (online 2016)', grade: 'SR/MA', finding: 'More weekly sets gave more growth; even under 5 sets a week still grew.', pmid: '27433992', doi: '10.1080/02640414.2016.1210197' },
      { cite: 'Currier et al. 2026, ACSM Position Stand, *Med Sci Sports Exerc* 58(4):851–872', grade: 'SR/MA', finding: 'Size is helped by 10 or more weekly sets; strength by heavier loads and 2 or more sessions a week.', pmid: '41843416', doi: '10.1249/MSS.0000000000003897' },
      { cite: 'Pelland et al. 2025, *Sports Med* 56(2):481–505 (print 2026)', grade: 'SR/MA', finding: 'Volume helps size and strength with diminishing returns; frequency clearly helped strength and barely size.', pmid: '41343037', doi: '10.1007/s40279-025-02344-w' },
    ],
  },
  'volume-cap': {
    use: 'stacking sets past the range adds little',
    sources: [
      { cite: 'Baz-Valle et al. 2022, *J Hum Kinet* 81:199–210', grade: 'SR/MA', finding: 'In young trained men, 12 to 20 weekly sets did as well as more than 20 for quads and biceps.', pmid: '35291645', doi: '10.2478/hukin-2022-0017' },
      { cite: 'Israetel / Renaissance Periodization coaching bands', grade: 'our rule', finding: 'The set ranges are a coaching band; no study sets them.' },
    ],
  },
  frequency: {
    use: 'twice a week per muscle helps strength; size depends on weekly sets, not on how they are spread',
    sources: [
      { cite: 'Pelland et al. 2025, *Sports Med* 56(2):481–505 (print 2026)', grade: 'SR/MA', finding: 'Volume helps size and strength with diminishing returns; frequency clearly helped strength and barely size.', pmid: '41343037', doi: '10.1007/s40279-025-02344-w' },
      { cite: 'Currier et al. 2026, ACSM Position Stand, *Med Sci Sports Exerc* 58(4):851–872', grade: 'SR/MA', finding: 'Size is helped by 10 or more weekly sets; strength by heavier loads and 2 or more sessions a week.', pmid: '41843416', doi: '10.1249/MSS.0000000000003897' },
      { cite: 'Schoenfeld, Grgic & Krieger 2019, *J Sports Sci* 37(11):1286–1295 (online 2018)', grade: 'SR/MA', finding: 'With equal volume, training frequency does not meaningfully change muscle growth.', pmid: '30558493', doi: '10.1080/02640414.2018.1555906' },
    ],
  },
  'sets-per-exercise': {
    use: '2 to 4 sets per exercise; more on one exercise adds little',
    sources: [
      { cite: 'Krieger 2010, *J Strength Cond Res* 24(4):1150–1159', grade: 'SR/MA', finding: 'Several sets beat one set for size; 2 to 3 and 4 to 6 sets per exercise did not differ significantly.', pmid: '20300012', doi: '10.1519/JSC.0b013e3181d4d436' },
      { cite: 'Cap of 4 sets, 3 for a beginner', grade: 'our rule', finding: 'The cap per exercise is our rule; no study sets it.' },
    ],
  },
  effort: {
    use: 'big lifts stop 1 to 3 reps short; failure adds fatigue, not growth',
    sources: [
      { cite: 'Robinson et al. 2024, *Sports Med* 54(9):2209–2231', grade: 'SR/MA', finding: 'Size gains rise as sets end closer to failure; strength is similar across a wide range of reps in reserve.', pmid: '38970765', doi: '10.1007/s40279-024-02069-2' },
      { cite: 'Refalo et al. 2023, *Sports Med* 53(3):649–665 (online 2022)', grade: 'SR/MA', finding: 'Going to momentary failure is not better than stopping short for size.', pmid: '36334240', doi: '10.1007/s40279-022-01784-y' },
      { cite: 'Refalo et al. 2024, *J Sports Sci* 42(1):85–101', grade: 'RCT', finding: 'In trained lifters, quad growth was the same at failure or 1 to 2 reps short; failure caused more fatigue.', pmid: '38393985', doi: '10.1080/02640414.2024.2321021' },
    ],
  },
  'rep-range': {
    use: 'size grows across wide rep ranges; heavy loads for strength',
    sources: [
      { cite: 'Schoenfeld, Grgic, Ogborn & Krieger 2017, *J Strength Cond Res* 31(12):3508–3523', grade: 'SR/MA', finding: 'With sets taken to failure, low and high loads give similar growth; high loads give more 1RM.', pmid: '28834797', doi: '10.1519/JSC.0000000000002200' },
      { cite: 'Lopez et al. 2021, *Med Sci Sports Exerc* 53(6):1206–1216', grade: 'SR/MA', finding: 'Growth does not depend on load; strength is better with high and moderate loads than with low.', pmid: '33433148', doi: '10.1249/MSS.0000000000002585' },
    ],
  },
  progression: {
    use: 'adding reps or adding load both work',
    sources: [
      { cite: 'Plotkin et al. 2022, *PeerJ* 10:e14142', grade: 'RCT', finding: 'In trained lifters over 8 weeks, adding reps and adding load gave similar results.', pmid: '36199287', doi: '10.7717/peerj.14142' },
      { cite: 'Chaves et al. 2024, *Int J Sports Med* 45(7):504–510', grade: 'RCT', finding: 'In untrained people over 10 weeks, adding load and adding reps gave similar strength and size gains.', pmid: '38286426', doi: '10.1055/a-2256-5857' },
    ],
  },
  split: {
    use: 'split and full body do equally well; pick by days available',
    sources: [
      { cite: 'Ramos-Campo et al. 2024, *J Strength Cond Res* 38(7):1330–1340', grade: 'SR/MA', finding: 'Split and full-body routines give similar strength and size gains.', pmid: '38595233', doi: '10.1519/JSC.0000000000004774' },
    ],
  },
  order: {
    use: 'the lift that matters most goes first',
    sources: [
      { cite: 'Nunes et al. 2021, *Eur J Sport Sci* 21(2):149–157 (online 2020)', grade: 'SR/MA', finding: 'Strength gains are largest in the exercise done first; order did not change size.', pmid: '32077380', doi: '10.1080/17461391.2020.1733672' },
    ],
  },
  rest: {
    use: 'longer rest is slightly favoured for growth',
    sources: [
      { cite: 'Singer et al. 2024, *Front Sports Act Living* 6:1429789', grade: 'SR/MA', finding: 'Growth overlapped across rest lengths; estimates slightly favoured rest over 60 s for arms and thighs.', pmid: '39205815', doi: '10.3389/fspor.2024.1429789' },
      { cite: 'Exact rest seconds', grade: 'our rule', finding: 'The exact seconds of rest are our rule; no study sets them.' },
    ],
  },
  supersets: {
    use: 'supersets save time without losing gains',
    sources: [
      { cite: 'Zhang et al. 2025, *Sports Med* 55(4):953–975', grade: 'SR/MA', finding: 'Supersets keep volume, strength and size gains the same while cutting session time.', pmid: '39903375', doi: '10.1007/s40279-025-02176-8' },
    ],
  },
  deload: {
    use: 'an easy week reduces training, it never removes it',
    sources: [
      { cite: 'Coleman et al. 2024, *PeerJ* 12:e16777', grade: 'RCT', finding: 'A full week off midway through 9 weeks did not change growth and slightly blunted lower-body strength.', pmid: '38274324', doi: '10.7717/peerj.16777' },
      { cite: 'Bell et al. 2023, *Sports Med Open* 9:87', grade: 'P', finding: 'Coach consensus on what a deload is and how to design one; it gives no evidence-based interval.', pmid: '37730925', doi: '10.1186/s40798-023-00633-0' },
      { cite: 'Easy-week interval', grade: 'our rule', finding: 'How often to take an easy week is our rule; no study sets it.' },
    ],
  },
  'short-session': {
    use: 'a short session is slower, not useless',
    sources: [
      { cite: 'Androulakis-Korakakis, Fisher & Steele 2020, *Sports Med* 50(4):751–765', grade: 'SR/MA', finding: 'A single set of 6 to 12 reps, 2 to 3 times a week, gives suboptimal but real strength gains in trained men.', pmid: '31797219', doi: '10.1007/s40279-019-01236-0' },
      { cite: 'Nuzzo et al. 2024, *Sports Med* 54(5):1139–1162', grade: 'Review', finding: 'Minimal-dose strategies (one session a week, single sets, short sessions) all raise strength in people who do not lift now.', pmid: '38509414', doi: '10.1007/s40279-024-02009-0' },
    ],
  },
};

export const TAGS = Object.keys(EVIDENCE);
