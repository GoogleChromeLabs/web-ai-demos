/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './ReviewCard.css';
import RatingStars from './RatingStars';

export default function ReviewCard(props) {
  const { user, review, rating } = props;
  return (
    <div class="review-card">
      <div class="user">{user}</div>
      <div class="review">
        <RatingStars rating={rating} />
        <div>{review}</div>
      </div>
    </div>
  );
}
