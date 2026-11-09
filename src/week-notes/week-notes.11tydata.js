// Works out each note's year, week and title from where its file is saved:
// src/week-notes/2026/14.md is week 14 of 2026.
const match = (data) => /\/week-notes\/(\d{4})\/(\d{1,2})$/.exec(data.page.filePathStem);

export default {
  layout: "layouts/note.njk",
  eleventyComputed: {
    year: (data) => (match(data) ? Number(match(data)[1]) : undefined),
    week: (data) => (match(data) ? Number(match(data)[2]) : undefined),
    noteTitle: (data) => (match(data) ? `Week ${Number(match(data)[2])}, ${match(data)[1]}` : undefined),
    weekStart: (data) =>
      match(data) ? data.isoWeekStart(Number(match(data)[1]), Number(match(data)[2])) : undefined,
  },
};
