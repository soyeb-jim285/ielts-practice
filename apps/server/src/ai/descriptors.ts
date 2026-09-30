// Condensed public IELTS band descriptors (Speaking + Writing, rev. May 2023), bands 4-9.
// Adapted from the IELTS public band descriptors, © IELTS Partners (British Council, IDP, Cambridge University Press & Assessment).
// Wording kept close to the official text so the model can quote it in `descriptor`. See docs/research.md §1, scoring-research.md §5.

/** Descriptors by band (4-9) as the prompt lists them, highest first. */
export const fmt = (bands: Record<number, string>) =>
  Object.entries(bands)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([b, t]) => `  Band ${b}: ${t}`)
    .join('\n');

export const SPEAKING_DESCRIPTORS = {
  fc: ({
    9: 'Fluent with only very occasional repetition or self-correction. Any hesitation that occurs is used only to prepare the content of the next utterance and not to find words or grammar. Speech is situationally appropriate and cohesive features are fully acceptable. Topic development is fully coherent and appropriately extended.',
    8: 'Fluent with only very occasional repetition or self-correction. Hesitation may occasionally be used to find words or grammar, but most will be content related. Topic development is coherent, appropriate and relevant.',
    7: 'Able to keep going and readily produce long turns without noticeable effort. Some hesitation, repetition and/or self-correction may occur, often mid-sentence and indicate problems with accessing appropriate language. However, these will not affect coherence. Flexible use of spoken discourse markers, connectives and cohesive features.',
    6: 'Able to keep going and demonstrates a willingness to produce long turns. Coherence may be lost at times as a result of hesitation, repetition and/or self-correction. Uses a range of spoken discourse markers, connectives and cohesive features though not always appropriately.',
    5: 'Usually able to keep going, but relies on repetition and self-correction to do so and/or on slow speech. Hesitations are often associated with mid-sentence searches for fairly basic lexis and grammar. Overuse of certain discourse markers, connectives and other cohesive features. More complex speech usually causes disfluency but simpler language may be produced fluently.',
    4: 'Unable to keep going without noticeable pauses. Speech may be slow with frequent repetition. Often self-corrects. Can link simple sentences but often with repetitious use of connectives. Some breakdowns in coherence.',
  }),
  lr: ({
    9: 'Total flexibility and precise use in all contexts. Sustained use of accurate and idiomatic language.',
    8: 'Wide resource, readily and flexibly used to discuss all topics and convey precise meaning. Skilful use of less common and idiomatic items despite occasional inaccuracies in word choice and collocation. Effective use of paraphrase as required.',
    7: 'Resource flexibly used to discuss a variety of topics. Some ability to use less common and idiomatic items and an awareness of style and collocation is evident though inappropriacies occur. Effective use of paraphrase as required.',
    6: 'Resource sufficient to discuss topics at length. Vocabulary use may be inappropriate but meaning is clear. Generally able to paraphrase successfully.',
    5: 'Resource sufficient to discuss familiar and unfamiliar topics but there is limited flexibility. Attempts paraphrase but not always with success.',
    4: 'Resource sufficient for familiar topics but only basic meaning can be conveyed on unfamiliar topics. Frequent inappropriacies and errors in word choice. Rarely attempts paraphrase.',
  }),
  gra: ({
    9: "Structures are precise and accurate at all times, apart from 'mistakes' characteristic of native speaker speech.",
    8: 'Wide range of structures, flexibly used. The majority of sentences are error free. Occasional inappropriacies and non-systematic errors occur. A few basic errors may persist.',
    7: 'A range of structures flexibly used. Error-free sentences are frequent. Both simple and complex sentences are used effectively despite some errors. A few basic errors persist.',
    6: 'Produces a mix of short and complex sentence forms and a variety of structures with limited flexibility. Though errors frequently occur in complex structures, these rarely impede communication.',
    5: 'Basic sentence forms are fairly well controlled for accuracy. Complex structures are attempted but these are limited in range, nearly always contain errors and may lead to the need for reformulation.',
    4: 'Can produce basic sentence forms and some short utterances are error-free. Subordinate clauses are rare and, overall, turns are short, structures are repetitive and errors are frequent.',
  }),
  p: ({
    9: 'Uses a full range of phonological features to convey precise and/or subtle meaning. Flexible use of features of connected speech is sustained throughout. Can be effortlessly understood throughout. Accent has no effect on intelligibility.',
    8: 'Uses a wide range of phonological features to convey precise and/or subtle meaning. Can sustain appropriate rhythm. Flexible use of stress and intonation across long utterances, despite occasional lapses. Can be easily understood throughout. Accent has minimal effect on intelligibility.',
    7: 'Displays all the positive features of band 6, and some, but not all, of the positive features of band 8.',
    6: 'Uses a range of phonological features, but control is variable. Chunking is generally appropriate, but rhythm may be affected by a lack of stress-timing and/or a rapid speech rate. Some effective use of intonation and stress, but this is not sustained. Individual words or phonemes may be mispronounced but this causes only occasional lack of clarity. Can generally be understood throughout without much effort.',
    5: 'Displays all the positive features of band 4, and some, but not all, of the positive features of band 6.',
    4: 'Uses some acceptable phonological features, but the range is limited. Produces some acceptable chunking, but there are frequent lapses in overall rhythm. Attempts to use intonation and stress, but control is limited. Individual words or phonemes are frequently mispronounced, causing lack of clarity. Understanding requires some effort and there may be patches of speech that cannot be understood.',
  }),
};

const TA_T1 = ({
  9: 'All the requirements of the task are fully and appropriately satisfied. There may be extremely rare lapses in content.',
  8: 'The response covers all the requirements of the task appropriately, relevantly and sufficiently. (Academic) Key features are skilfully selected, and clearly presented, highlighted and illustrated. (GT) All bullet points are clearly presented, and appropriately illustrated or extended. There may be occasional omissions or lapses in content.',
  7: 'The response covers the requirements of the task. The content is relevant and accurate – there may be a few omissions or lapses. The format is appropriate. (Academic) Key features which are selected are covered and clearly highlighted but could be more fully or more appropriately illustrated or extended. (Academic) It presents a clear overview, the data are appropriately categorised, and main trends or differences are identified. (GT) All bullet points are covered and clearly highlighted but could be more fully or more appropriately illustrated or extended. (GT) It presents a clear purpose. The tone is consistent and appropriate to the task. Any lapses are minimal.',
  6: 'The response focuses on the requirements of the task and an appropriate format is used. (Academic) Key features are covered and adequately highlighted. A relevant overview is attempted. Information is appropriately selected and supported using figures/data. (GT) All bullet points are covered and adequately highlighted. The purpose is generally clear. There may be minor inconsistencies in tone. Some irrelevant, inappropriate or inaccurate information may occur in areas of detail or when illustrating or extending the main points. Some details may be missing (or excessive) and further extension or illustration may be needed.',
  5: 'The response generally addresses the requirements of the task. The format may be inappropriate in places. (Academic) Key features are not adequately covered. The recounting of detail is mainly mechanical. There may be no data to support the description. (GT) All bullet points are presented but one or more may not be adequately covered. The purpose may be unclear at times. The tone may be variable and sometimes inappropriate. There may be a tendency to focus on details (without referring to the bigger picture). The inclusion of irrelevant, inappropriate or inaccurate material in key areas detracts from the task achievement. There is limited detail when extending and illustrating the main points.',
  4: 'The response is an attempt to address the task. (Academic) Few key features have been selected. (GT) Not all bullet points are presented. (GT) The purpose of the letter is not clearly explained and may be confused. The tone may be inappropriate. The format may be inappropriate. Key features/bullet points which are presented may be irrelevant, repetitive, inaccurate or inappropriate.',
});

const TR_T2 = ({
  9: 'The prompt is appropriately addressed and explored in depth. A clear and fully developed position is presented which directly answers the question/s. Ideas are relevant, fully extended and well supported. Any lapses in content or support are extremely rare.',
  8: 'The prompt is appropriately and sufficiently addressed. A clear and well-developed position is presented in response to the question/s. Ideas are relevant, well extended and supported. There may be occasional omissions or lapses in content.',
  7: 'The main parts of the prompt are appropriately addressed. A clear and developed position is presented. Main ideas are extended and supported but there may be a tendency to over-generalise or there may be a lack of focus and precision in supporting ideas/material.',
  6: 'The main parts of the prompt are addressed (though some may be more fully covered than others). An appropriate format is used. A position is presented that is directly relevant to the prompt, although the conclusions drawn may be unclear, unjustified or repetitive. Main ideas are relevant, but some may be insufficiently developed or may lack clarity, while some supporting arguments and evidence may be less relevant or inadequate.',
  5: 'The main parts of the prompt are incompletely addressed. The format may be inappropriate in places. The writer expresses a position, but the development is not always clear. Some main ideas are put forward, but they are limited and are not sufficiently developed and/or there may be irrelevant detail. There may be some repetition.',
  4: 'The prompt is tackled in a minimal way, or the answer is tangential, possibly due to some misunderstanding of the prompt. The format may be inappropriate. A position is discernible, but the reader has to read carefully to find it. Main ideas are difficult to identify and such ideas that are identifiable may lack relevance, clarity and/or support. Large parts of the response may be repetitive.',
});

export const WRITING_DESCRIPTORS = {
  ta1: TA_T1,
  tr2: TR_T2,
  cc: ({
    9: 'The message can be followed effortlessly. Cohesion is used in such a way that it very rarely attracts attention. Any lapses in coherence or cohesion are minimal. Paragraphing is skilfully managed.',
    8: 'The message can be followed with ease. Information and ideas are logically sequenced, and cohesion is well managed. Occasional lapses in coherence and cohesion may occur. Paragraphing is used sufficiently and appropriately.',
    7: 'Information and ideas are logically organised, and there is a clear progression throughout the response. (A few lapses may occur, but these are minor.) A range of cohesive devices including reference and substitution is used flexibly but with some inaccuracies or some over/under use. Paragraphing is generally used effectively to support overall coherence, and the sequencing of ideas within a paragraph is generally logical.',
    6: 'Information and ideas are generally arranged coherently and there is a clear overall progression. Cohesive devices are used to some good effect but cohesion within and/or between sentences may be faulty or mechanical due to misuse, overuse or omission. The use of reference and substitution may lack flexibility or clarity and result in some repetition or error. Paragraphing may not always be logical and/or the central topic may not always be clear.',
    5: 'Organisation is evident but is not wholly logical and there may be a lack of overall progression. Nevertheless, there is a sense of underlying coherence to the response. The relationship of ideas can be followed but the sentences are not fluently linked to each other. There may be limited/overuse of cohesive devices with some inaccuracy. The writing may be repetitive due to inadequate and/or inaccurate use of reference and substitution. Paragraphing may not be used or may be inadequate/illogical.',
    4: 'Information and ideas are evident but not arranged coherently and there is no clear progression within the response. Relationships between ideas can be unclear and/or inadequately marked. There is some use of basic cohesive devices, which may be inaccurate or repetitive. There is inaccurate use or lack of substitution or referencing. There may be no paragraphing and/or no clear main topic within paragraphs.',
  }),
  lr: ({
    9: 'Full flexibility and precise use are widely evident. A wide range of vocabulary is used accurately and appropriately with very natural and sophisticated control of lexical features. Minor errors in spelling and word formation are extremely rare and have minimal impact on communication.',
    8: 'A wide resource is fluently and flexibly used to convey precise meanings. There is skilful use of uncommon and/or idiomatic items when appropriate, despite occasional inaccuracies in word choice and collocation. Occasional errors in spelling and/or word formation may occur, but have minimal impact on communication.',
    7: 'The resource is sufficient to allow some flexibility and precision. There is some ability to use less common and/or idiomatic items. An awareness of style and collocation is evident, though inappropriacies occur. There are only a few errors in spelling and/or word formation and they do not detract from overall clarity.',
    6: 'The resource is generally adequate and appropriate for the task. The meaning is generally clear in spite of a rather restricted range or a lack of precision in word choice. If the writer is a risk-taker, there will be a wider range of vocabulary used but higher degrees of inaccuracy or inappropriacy. There are some errors in spelling and/or word formation, but these do not impede communication.',
    5: 'The resource is limited but minimally adequate for the task. Simple vocabulary may be used accurately but the range does not permit much variation in expression. There may be frequent lapses in the appropriacy of word choice and a lack of flexibility is apparent in frequent simplifications and/or repetitions. Errors in spelling and/or word formation may be noticeable and may cause some difficulty for the reader.',
    4: 'The resource is limited and inadequate for or unrelated to the task. Vocabulary is basic and may be used repetitively. There may be inappropriate use of lexical chunks (e.g. memorised phrases, formulaic language and/or language from the input material). Inappropriate word choice and/or errors in word formation and/or in spelling may impede meaning.',
  }),
  gra: ({
    9: 'A wide range of structures is used with full flexibility and control. Punctuation and grammar are used appropriately throughout. Minor errors are extremely rare and have minimal impact on communication.',
    8: 'A wide range of structures is flexibly and accurately used. The majority of sentences are error-free, and punctuation is well managed. Occasional, non-systematic errors and inappropriacies occur, but have minimal impact on communication.',
    7: 'A variety of complex structures is used with some flexibility and accuracy. Grammar and punctuation are generally well controlled, and error-free sentences are frequent. A few errors in grammar may persist, but these do not impede communication.',
    6: 'A mix of simple and complex sentence forms is used but flexibility is limited. Examples of more complex structures are not marked by the same level of accuracy as in simple structures. Errors in grammar and punctuation occur, but rarely impede communication.',
    5: 'The range of structures is limited and rather repetitive. Although complex sentences are attempted, they tend to be faulty, and the greatest accuracy is achieved on simple sentences. Grammatical errors may be frequent and cause some difficulty for the reader. Punctuation may be faulty.',
    4: 'A very limited range of structures is used. Subordinate clauses are rare and simple sentences predominate. Some structures are produced accurately but grammatical errors are frequent and may impede meaning. Punctuation is often faulty or inadequate.',
  }),
};

export const BELOW_4 =
  'Bands 3 and below: meaning is conveyed only in very limited ways — long pauses or isolated words, very basic vocabulary for personal information, few correct sentence forms, frequent breakdowns in communication or intelligibility (speaking), or a response largely unrelated to the task with little control of organisation, vocabulary or grammar (writing). Band 0 (writing only): did not attempt, wholly memorised, or totally unrelated to the task. In speaking, off-topic answers are rated under Fluency and Coherence (coherence and relevance), never band 0 for connected speech.';

/** Shared rules for the feedback prompts. The scoring procedure (best fit, no favoured bands) lives in the neutral scorer prompt (prompts.ts). */
export const EXAMINER_RULES = `SCORING DISCIPLINE (apply to every criterion):
1. Best fit, as certified examiners mark: for each criterion, read the descriptors of the bands above and below and award the band whose descriptor BEST fits the response overall. A band is not withheld for one weaker feature if its other features are clearly met, and one isolated strength does not lift a band.
2. "descriptor": copy the phrase(s) of the AWARDED band from the descriptors below, verbatim, that best match this response.
3. "evidence": up to 4 short quotes copied verbatim from the candidate's response that prove the band. Quotes only: never metric names, numbers or paraphrases (quotes not found in the response are discarded). Put metric observations in plain English in "summary" (e.g. "You spoke for about 40 seconds").
4. "summary": 1-2 plain sentences naming the specific feature of the next band that is missing.
5. Errors: list every clear, unambiguous error (max 40), most serious first. severity "major" = impedes meaning or is a basic, systematic error; otherwise "minor". Use only the allowed categories. Do not flag stylistic preferences or correct variants (British/American spelling, contractions in speech).
6. topFixes: EXACTLY 3, distinct, each targeting a recurring pattern that most limits the NEXT band (not one-off slips). "before" is verbatim from the response; "after" is the corrected/upgraded version; "why" names the descriptor feature it unlocks. Order by impact.
7. vocabUpgrades: up to 8 basic, vague or wrongly-used words/phrases from the response, each with up to 3 natural, context-appropriate alternatives a real speaker/writer at the next band would use. No obscure or showy words.
8. rewrite: the candidate's OWN response raised ONE band above the level you judge it to be — same ideas, same personal details, same voice and register, similar length. Fix the errors, upgrade the flagged language, improve linking. Do not add new arguments, facts or clichéd idioms. Plain text only.
9. Write feedback in clear, simple English addressed to the candidate ("you"). Be direct and specific; no praise padding.

${BELOW_4}`;

/** First sentence of a band's official descriptor (bands 4-9), for a pooled band that no sample described. */
export const bandDescriptor = (bands: Record<number, string>, band: number) => bands[band]?.split(/(?<=\.) /)[0];
