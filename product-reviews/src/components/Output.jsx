/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './Output.css';
import Spinner from './Spinner';
import ToxicityBadge from './ToxicityBadge';
import SentimentBadge from './SentimentBadge';
import RatingStars from './RatingStars';
import { TOXICITY, SENTIMENT, RATING } from '../.consts';

function getValueJsx(outputType, value) {
  let jsx = null;
  switch (outputType) {
    case TOXICITY:
      jsx = <ToxicityBadge isToxic={value} />;
      break;
    case SENTIMENT:
      jsx = <SentimentBadge sentiment={value} />;
      break;
    case RATING:
      jsx = <RatingStars rating={value} />;
      break;
    default:
      jsx = <div>{value}</div>;
      break;
  }
  return jsx;
}

export default function Output(props) {
  const { outputType, title, isThinking, value } = props;
  return (
    <div class="output-wrapper">
      <div class="output-label">{title ? `${title}:` : ''}</div>
      <div class="output-result">
        {isThinking ? (
          <Spinner />
        ) : (
          <div class="value">
            <div class="flash">✦</div>
            {getValueJsx(outputType, value)}
          </div>
        )}
      </div>
    </div>
  );
}
