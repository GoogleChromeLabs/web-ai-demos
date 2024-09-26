/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './SentimentBadge.css';
import { POSITIVE, NEGATIVE, UNKNOWN } from '../.consts';

function getCssClass(sentiment) {
  let cssClass = null;
  switch (sentiment) {
    case POSITIVE:
      cssClass = 'badge positive';
      break;
    case NEGATIVE:
      cssClass = 'badge negative';
      break;
    case UNKNOWN:
      cssClass = 'badge unknown';
      break;
    default:
      cssClass = 'badge unknown';
      break;
  }
  return cssClass;
}

function getDisplayText(sentiment) {
  let displayText = null;
  switch (sentiment) {
    case POSITIVE:
      displayText = 'positive';
      break;
    case NEGATIVE:
      displayText = 'negative';
      break;
    case UNKNOWN:
      displayText = 'unknown';
      break;
    default:
      displayText = 'unknown';
      break;
  }
  return displayText;
}

export default function SentimentBadge(props) {
  const { sentiment } = props;
  const s = sentiment.toLowerCase();
  if (!s) {
    return <div></div>;
  } else {
    return <div class={getCssClass(s)}>{getDisplayText(s)}</div>;
  }
}
