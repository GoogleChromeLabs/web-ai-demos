/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export function generateGemmaLLmPrompt(review) {
  return `Analyze a product review, and then based on your analysis give me the corresponding rating (integer). The rating should be an integer between 1 and 5. 1 is the worst rating, and 5 is the best rating. A strongly dissatisfied review that only mentions issues should have a rating of 1 (worst). A strongly satisfied review that only mentions positives and upsides should have a rating of 5 (best). Be opinionated. Use the full range of possible ratings (1 to 5). \n\n
    \n\n
    Here are some examples of reviews and their corresponding analyses and ratings:
    \n\n
    Review: 'Stylish and functional. Not sure how it'll handle rugged outdoor use, but it's perfect for urban exploring.'
    Analysis: The reviewer appreciates the product's style and basic functionality. They express some uncertainty about its ruggedness but overall find it suitable for their intended use, resulting in a positive, but not top-tier rating.
    Rating (integer): 4
    \n\n
    Review: 'It's a solid backpack at a decent price. Does the job, but nothing particularly amazing about it.'
    Analysis: This reflects an average opinion. The backpack is functional and fulfills its essential purpose. However, the reviewer finds it unremarkable and lacking any standout features deserving of higher praise.
    Rating (integer): 3
    \n\n
    Review: 'The waist belt broke on my first trip! Customer service was unresponsive too. Would not recommend.'
    Analysis: A serious product defect and poor customer service experience naturally warrants the lowest possible rating. The reviewer is extremely unsatisfied with both the product and the company.
    Rating (integer): 1
    \n\n
    Review: 'Love how many pockets and compartments it has. Keeps everything organized on long trips. Durable too!'
    Analysis: The enthusiastic review highlights specific features the user loves (organization and durability), indicating great satisfaction with the product. This justifies the highest rating.
    Rating (integer): 5
    \n\n
    Review: 'The straps are a bit flimsy, and they started digging into my shoulders under heavy loads.'
    Analysis: While not a totally negative review, a significant comfort issue leads the reviewer to rate the product poorly. The straps are a key component of a backpack, and their failure to perform well under load is a major flaw.
    Rating (integer): 1
    \n\n
    Now, here is the review you need to assess:
    \n
    Review: "${review}" \n`;
}
