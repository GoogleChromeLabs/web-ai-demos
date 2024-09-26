/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './RatingStars.css';
import starYellow from '../assets/star-yellow.svg';
import starGrey from '../assets/star-grey.svg';

function getRatingStars(rating) {
  // rating is an integer between 1 and 5
  const ratingNum = parseInt(rating);
  const ratingStars = [];
  for (let i = 0; i < 5; i++) {
    if (i < ratingNum) {
      ratingStars.push(true);
    } else {
      ratingStars.push(false);
    }
  }
  return ratingStars;
}

export default function RatingStars(props) {
  const { rating } = props;
  const ratingStars = getRatingStars(rating);
  return (
    <div class="rating-stars-wrapper">
      {ratingStars.map((isStarOn) => (
        <img class="star" src={isStarOn ? starYellow : starGrey} alt="star" />
      ))}
    </div>
  );
}
