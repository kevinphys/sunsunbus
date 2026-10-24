// 小水滴、果實的 SVG（取自 wireframe）。
const svg = (label: string, w: number, h: number, vb: string, body: string) =>
  `<svg role="img" aria-label="${label}" width="${w}" height="${h}" viewBox="${vb}">${body}</svg>`;

export const dropReady = svg(
  '小水滴角色，準備上車', 90, 104, '0 0 96 112',
  '<path d="M48 6 C 30 36, 14 56, 14 74 A 34 34 0 0 0 82 74 C 82 56, 66 36, 48 6 Z" fill="#7CC4E4" stroke="#2C7FA8" stroke-width="3"/><circle cx="36" cy="72" r="5" fill="#15302B"/><circle cx="60" cy="72" r="5" fill="#15302B"/><path d="M38 88 Q 48 96 58 88" fill="none" stroke="#15302B" stroke-width="3" stroke-linecap="round"/><ellipse cx="32" cy="52" rx="6" ry="10" fill="#D8F0FA"/>',
);

export const dropCalm = svg(
  '小水滴穩穩坐著', 150, 170, '0 0 160 180',
  '<path d="M80 10 C 50 60, 24 92, 24 120 A 56 56 0 0 0 136 120 C 136 92, 110 60, 80 10 Z" fill="#7CC4E4" stroke="#D8F0FA" stroke-width="4"/><circle cx="60" cy="118" r="7" fill="#15302B"/><circle cx="100" cy="118" r="7" fill="#15302B"/><path d="M62 140 Q 80 154 98 140" fill="none" stroke="#15302B" stroke-width="5" stroke-linecap="round"/><ellipse cx="54" cy="86" rx="9" ry="16" fill="#D8F0FA"/>',
);

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
