Component({
  properties: {
    height: { type: Number, value: 580 },
    peek: { type: Number, value: 116 },
    disabled: { type: Boolean, value: false },
    files: { type: Array, value: [] },
    totalSize: { type: String, value: '0 B' },
    loading: { type: Boolean, value: true },
    error: { type: String, value: '' }
  },
  data: { expanded: false, motion: { height: 580, peek: 116, expanded: false, disabled: false, version: 0 } },
  observers: {
    'height, peek, disabled, expanded': function () { this.syncMotion(); }
  },
  lifetimes: {
    attached() { this._alive = true; this.syncMotion(); },
    detached() { this._alive = false; }
  },
  pageLifetimes: {
    show() { this._pageHidden = false; },
    hide() {
      this._pageHidden = true;
      this._motionVersion = (this._motionVersion || 0) + 1;
      this.setData({ expanded: false });
      this.syncMotion();
      this.triggerEvent('settle', { expanded: false, hidden: true });
    }
  },
  methods: {
    syncMotion() {
      this.setData({ motion: { height: this.data.height, peek: this.data.peek,
        expanded: this.data.expanded, disabled: this.data.disabled, version: this._motionVersion || 0 } });
    },
    dragStarted() { if (this._alive) this.triggerEvent('opening'); },
    settled(value) {
      if (!this._alive) return;
      const expanded = !!value.expanded && !this._pageHidden && (!this.data.disabled || this.data.expanded);
      this.setData({ expanded });
      this.triggerEvent('settle', { expanded, hidden: !!this._pageHidden });
    },
    fileTap(value) {
      if (this.data.expanded && !this.data.disabled) this.triggerEvent('filetap', { id: value.id });
    },
    retry() { if (!this.data.disabled) this.triggerEvent('refresh'); }
  }
});
