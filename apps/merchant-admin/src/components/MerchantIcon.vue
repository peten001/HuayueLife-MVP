<script setup lang="ts">
defineProps<{ name: string }>();
const paths: Record<string, string[]> = {
  home: ['M4 19V5', 'M4 19h16', 'm7 14 4-5 4 3 5-7'],
  products: ['M4 6h16v14H4z', 'M8 6V3h8v3', 'M8 11h8', 'M8 15h5'],
  orders: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6', 'M9 12h6'],
  settlements: ['M3 6h17v14H3z', 'M3 6V4h14', 'M15 11h6v5h-6z'],
  tables: ['M3 8h18v5H3z', 'M6 13v8', 'M18 13v8', 'M7 8V3', 'M17 8V3'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01', 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'],
  ellipsis: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  settings: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8', 'M12 2v3', 'M12 19v3', 'M2 12h3', 'M19 12h3', 'm5 5 2 2', 'm17 17 2 2', 'm5 19 2-2', 'm17 7 2-2'],
  staff: ['M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8', 'M4 21v-3a8 8 0 0 1 16 0v3'],
  print: ['M6 8V3h12v5', 'M6 17H3V8h18v9h-3', 'M6 14h12v7H6z'],
  back: ['m14 5-7 7 7 7'],
  calendar: ['M3 5h18v16H3z', 'M7 2v6', 'M17 2v6', 'M3 10h18'],
  search: ['M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0', 'm15 15 6 6'],
  sort: ['M8 20V4 M4 8l4-4 4 4', 'M16 4v16 M12 16l4 4 4-4'],
  bank: ['m3 8 9-5 9 5z', 'M5 10v8', 'M10 10v8', 'M15 10v8', 'M20 10v8', 'M3 21h18'],
  plus: ['M12 5v14', 'M5 12h14'],
  filter: ['M4 6h16', 'M7 12h10', 'M10 18h4'],
  edit: ['m16 3 5 5-12 12-6 1 1-6z', 'm14 5 5 5'],
  store: ['M3 10h18l-2-7H5z','M5 10v11h14V10','M9 21v-7h6v7'],
  records: ['M5 3h14v18H5z','M9 8h6','M9 12h6','M9 16h4'],
  user: ['M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8','M4 21v-3a8 8 0 0 1 16 0v3'],
  language: ['M2.5 12a9.5 9.5 0 1 0 19 0 9.5 9.5 0 0 0-19 0Z', 'M12 2.5c2.2 2.5 3.4 5.7 3.4 9.5S14.2 19 12 21.5C9.8 19 8.6 15.8 8.6 12S9.8 5 12 2.5Z', 'M3.2 9h17.6', 'M3.2 15h17.6'],
  logout: ['M10 17l5-5-5-5', 'M15 12H3', 'M13 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6'],
};
</script>
<template><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path v-for="(path, index) in paths[name] || paths.more" :key="index" :d="path" /></svg></template>
