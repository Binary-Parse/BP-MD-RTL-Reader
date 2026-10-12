'use strict';

const BACKGROUNDS = Object.freeze({
  paper: '#E4E6E9',
  ink: '#08090B',
  sepia: '#D8CBB5',
  oasis: '#031211',
});

const BY_THEME = new Map(Object.entries(BACKGROUNDS));

function windowBackground(theme, followSystem, systemIsDark) {
  const chosen = followSystem ? (systemIsDark ? 'ink' : 'paper') : theme;
  return BY_THEME.get(chosen) || BACKGROUNDS.paper;
}

module.exports = { windowBackground, BACKGROUNDS };
