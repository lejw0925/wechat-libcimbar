const { REPOSITORY, copySourceLink } = require('../../services/project-links');

Component({
  data: { repository: REPOSITORY },
  methods: {
    copySource() { copySourceLink(wx); },
    recommendStar() { copySourceLink(wx, true); }
  }
});
