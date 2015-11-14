// Copyright 2015 Shyp, Inc.
//
// Stub of a metrics library. You should replace this with an implementation
// that's connected to your own metrics system.
module.exports = {
  measure: function(key, value) {
    console.log(key, value);
  },

  timing: function(key, startTime) {
    var diff = Date.now() - startTime;
    console.log(key, diff);
  },

  increment: function(key) {
    console.log(key, 1);
  },
};
