// 小水滴、果實的 SVG（取自 wireframe）。
const svg = (label: string, w: number, h: number, vb: string, body: string) =>
  `<svg role="img" aria-label="${label}" width="${w}" height="${h}" viewBox="${vb}">${body}</svg>`;

export const dropReady = svg(
  '你這顆小水滴，準備上車', 92, 106, '0 0 96 112',
  '<path d="M48 6 C 30 36, 14 56, 14 74 A 34 34 0 0 0 82 74 C 82 56, 66 36, 48 6 Z" fill="#7CC4E4" stroke="#2C7FA8" stroke-width="3"/><ellipse class="eye" cx="36" cy="72" rx="5" ry="5.5" fill="#15302B"/><ellipse class="eye" cx="60" cy="72" rx="5" ry="5.5" fill="#15302B"/><path d="M38 88 Q 48 96 58 88" fill="none" stroke="#15302B" stroke-width="3" stroke-linecap="round"/><ellipse cx="32" cy="52" rx="6" ry="10" fill="#D8F0FA"/>',
);

// 歡迎頁（wireframe ⓪）：會眨眼、臉紅的小水滴，底下有漣漪與閃光
export const welcomeSparkles = `<svg aria-hidden="true" width="150" height="140" viewBox="0 0 150 140" class="sparkles"><ellipse class="ripple" cx="75" cy="124" rx="44" ry="9" fill="none" stroke="#7CC4E4" stroke-width="2"/><ellipse class="ripple r2" cx="75" cy="124" rx="44" ry="9" fill="none" stroke="#7CC4E4" stroke-width="2"/><g fill="#F2A33A"><path class="tw" d="M18 30 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z"/><path class="tw t2" d="M130 22 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z"/><path class="tw t3" d="M136 92 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z"/></g></svg>`;

export const dropHero = svg(
  '你就是這顆小水滴', 96, 112, '0 0 96 112',
  '<path d="M48 6 C 30 36, 14 56, 14 74 A 34 34 0 0 0 82 74 C 82 56, 66 36, 48 6 Z" fill="#7CC4E4" stroke="#D8F0FA" stroke-width="3"/><ellipse class="eye" cx="36" cy="72" rx="5" ry="5.5" fill="#15302B"/><ellipse class="eye" cx="60" cy="72" rx="5" ry="5.5" fill="#15302B"/><ellipse cx="28" cy="84" rx="5" ry="3" fill="#F4A6A0" opacity="0.8"/><ellipse cx="68" cy="84" rx="5" ry="3" fill="#F4A6A0" opacity="0.8"/><path d="M38 88 Q 48 97 58 88" fill="none" stroke="#15302B" stroke-width="3" stroke-linecap="round"/><ellipse cx="32" cy="50" rx="6" ry="10" fill="#D8F0FA"/>',
);

const PATH_BLOOM = '<path d="M0 22 V8" stroke="#5FB3A0" stroke-width="2.5"/><g fill="#F2A33A"><circle cx="0" cy="-4" r="5"/><circle cx="6" cy="1" r="5"/><circle cx="4" cy="8" r="5"/><circle cx="-4" cy="8" r="5"/><circle cx="-6" cy="1" r="5"/></g><circle cx="0" cy="3" r="3.5" fill="#F7F3EA"/>';
const PATH_SPROUT = '<path d="M0 22 V10" stroke="#5FB3A0" stroke-width="2.5"/><g fill="#E9C46A"><circle cx="0" cy="0" r="4"/><circle cx="4.5" cy="4" r="4"/><circle cx="0" cy="8" r="4"/><circle cx="-4.5" cy="4" r="4"/></g><circle cx="0" cy="4" r="2.4" fill="#A9520F"/>';

/** 小動畫：小水滴沿路走，花依序開 */
export const welcomePath = `<div class="walk"><svg aria-hidden="true" width="300" height="52" viewBox="0 0 300 52"><path d="M0 44 H300" stroke="#5FB3A0" stroke-width="3" stroke-dasharray="8 6" stroke-linecap="round"/><g transform="translate(70 22)"><g class="bloom-in">${PATH_BLOOM}</g></g><g transform="translate(150 22)"><g class="bloom-in b2">${PATH_BLOOM}</g></g><g transform="translate(230 22)"><g class="bloom-in b3">${PATH_SPROUT}</g></g></svg><div class="walker"><svg class="hop" aria-hidden="true" width="24" height="28" viewBox="0 0 96 112"><path d="M48 6 C 30 36, 14 56, 14 74 A 34 34 0 0 0 82 74 C 82 56, 66 36, 48 6 Z" fill="#7CC4E4" stroke="#D8F0FA" stroke-width="6"/><circle cx="36" cy="72" r="7" fill="#15302B"/><circle cx="60" cy="72" r="7" fill="#15302B"/></svg></div></div>`;

export const fruitIcon = `<svg aria-hidden="true" width="20" height="20" viewBox="0 0 44 44"><circle cx="22" cy="26" r="15" fill="#9BCB5A"/><path d="M22 11 C 26 4, 34 4, 36 8 C 30 10, 26 10, 22 11 Z" fill="#2F7D6D"/></svg>`;

export const dropCalm = svg(
  '小水滴穩穩坐著', 150, 170, '0 0 160 180',
  '<path d="M80 10 C 50 60, 24 92, 24 120 A 56 56 0 0 0 136 120 C 136 92, 110 60, 80 10 Z" fill="#7CC4E4" stroke="#D8F0FA" stroke-width="4"/><ellipse class="eye" cx="60" cy="118" rx="7" ry="7.5" fill="#15302B"/><ellipse class="eye" cx="100" cy="118" rx="7" ry="7.5" fill="#15302B"/><ellipse cx="46" cy="134" rx="7" ry="4" fill="#F4A6A0" opacity="0.8"/><ellipse cx="114" cy="134" rx="7" ry="4" fill="#F4A6A0" opacity="0.8"/><path d="M62 140 Q 80 154 98 140" fill="none" stroke="#15302B" stroke-width="5" stroke-linecap="round"/><ellipse cx="54" cy="86" rx="9" ry="16" fill="#D8F0FA"/>',
);

/** 穩穩坐著時底下滴的水 */
export const drips = `<svg aria-hidden="true" class="drips" width="150" height="30" viewBox="0 0 150 30"><circle class="drip" cx="45" cy="6" r="4" fill="#7CC4E4"/><circle class="drip d2" cx="75" cy="6" r="4" fill="#7CC4E4"/><circle class="drip d3" cx="105" cy="6" r="4" fill="#7CC4E4"/></svg>`;

export const dropSplash = svg(
  '晃了一下，小水滴被甩出去', 190, 170, '0 0 200 180',
  '<path d="M110 30 C 86 70, 66 96, 66 118 A 44 44 0 0 0 154 118 C 154 96, 134 70, 110 30 Z" fill="#7CC4E4" stroke="#D8F0FA" stroke-width="4" transform="rotate(18 110 110)"/><path d="M92 112 l 10 8 m 0 -8 l -10 8" stroke="#15302B" stroke-width="4" stroke-linecap="round"/><path d="M122 108 l 10 8 m 0 -8 l -10 8" stroke="#15302B" stroke-width="4" stroke-linecap="round"/><ellipse cx="112" cy="140" rx="8" ry="6" fill="#15302B"/><g fill="#7CC4E4"><circle cx="34" cy="70" r="9"/><circle cx="20" cy="104" r="6"/><circle cx="44" cy="134" r="7"/><circle cx="182" cy="60" r="6"/></g>',
);

export const dropSearching = svg(
  '小水滴在找支架', 140, 150, '0 0 160 180',
  '<path d="M80 10 C 50 60, 24 92, 24 120 A 56 56 0 0 0 136 120 C 136 92, 110 60, 80 10 Z" fill="#7CC4E4" stroke="#D8F0FA" stroke-width="4"/><circle cx="60" cy="116" r="7" fill="#15302B"/><circle cx="100" cy="116" r="7" fill="#15302B"/><path d="M66 146 h28" stroke="#15302B" stroke-width="5" stroke-linecap="round"/>',
);

export const fruitNormal = (name: string) =>
  svg(
    `一顆${name}果實`, 40, 40, '0 0 44 44',
    '<circle cx="22" cy="26" r="15" fill="#9BCB5A"/><path d="M22 11 C 26 4, 34 4, 36 8 C 30 10, 26 10, 22 11 Z" fill="#2F7D6D"/><ellipse cx="17" cy="21" rx="4" ry="6" fill="#C8E59C"/>',
  );

export const fruitScout = svg(
  '一顆探路果', 40, 40, '0 0 44 44',
  '<circle cx="22" cy="26" r="15" fill="#B48ACB"/><path d="M22 11 C 26 4, 34 4, 36 8 C 30 10, 26 10, 22 11 Z" fill="#2F7D6D"/><path d="M14 26 h16 M22 18 v16" stroke="#F7F3EA" stroke-width="3" stroke-linecap="round"/>',
);

export const flowers = `<svg aria-hidden="true" width="200" height="40" viewBox="0 0 200 40"><g fill="#F2A33A"><circle cx="20" cy="20" r="14"/><circle cx="60" cy="20" r="14"/><circle cx="100" cy="20" r="14"/><circle cx="140" cy="20" r="14"/><circle cx="180" cy="20" r="14"/></g><g fill="#F7F3EA"><circle cx="20" cy="20" r="6"/><circle cx="60" cy="20" r="6"/><circle cx="100" cy="20" r="6"/><circle cx="140" cy="20" r="6"/><circle cx="180" cy="20" r="6"/></g></svg>`;

// 站間等級圖示（wireframe 第三版）：盛開＝五瓣花、小花＝發芽的小花、乾土＝裂開的土堆
const LEVEL_ICON_BODY = {
  bloom: '<g fill="#F2A33A"><circle cx="12" cy="6" r="4.2"/><circle cx="17.7" cy="10.2" r="4.2"/><circle cx="15.5" cy="17" r="4.2"/><circle cx="8.5" cy="17" r="4.2"/><circle cx="6.3" cy="10.2" r="4.2"/></g><circle cx="12" cy="12" r="3.2" fill="#F7F3EA"/>',
  sprout: '<path d="M12 22 V13" stroke="#5FB3A0" stroke-width="2.4" stroke-linecap="round"/><path d="M12 17 C 8 17, 6 15, 6 12 C 9 12, 11 14, 12 17 Z" fill="#5FB3A0"/><g fill="#E9C46A"><circle cx="12" cy="6" r="2.8"/><circle cx="15.2" cy="8.6" r="2.8"/><circle cx="12" cy="11.2" r="2.8"/><circle cx="8.8" cy="8.6" r="2.8"/></g><circle cx="12" cy="8.6" r="1.8" fill="#A9520F"/>',
  dry: '<path d="M2 20 C 5 12, 19 12, 22 20 Z" fill="#6B5A43"/><path d="M9 15 l 2 2 l -1 3 M15 15 l -1.5 2.5 l 1.5 2.5" fill="none" stroke="#C9A97A" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
};

/** 站間等級圖示；沒量到沒有圖示 */
export const levelIcon = (level: 'bloom' | 'sprout' | 'dry' | 'unmeasured', size: number) =>
  level === 'unmeasured' ? '' : `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24">${LEVEL_ICON_BODY[level]}</svg>`;
