/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './ToxicityBadge.css';

const getClass = (isToxic) => (isToxic ? 'badge toxic' : 'badge not-toxic');

const getDisplayText = (isToxic) => (isToxic ? 'toxic' : 'not toxic');

export default function ToxicityBadge(props) {
  const { isToxic } = props;
  return <div class={getClass(isToxic)}>{getDisplayText(isToxic)}</div>;
}
