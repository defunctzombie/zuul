'use strict';

var Array_isArray
  , Array_map
  , Array_forEach;

// this stuff's gotta work in IE6,7,8 -- thanks MS
exports.define = function () {
    Array_isArray = Array.isArray
    Array_map = Array.map
    Array_forEach = Array.forEach;

    // isarray only shims if Array.isArray is not present
    Array.isArray = require('isarray');
    if (typeof Array.map !== 'function') Array.map = require('array-map');
    if (typeof Array.forEach !== 'function') Array.forEach = require('foreach-shim');
};

exports.undefine = function () {
    Array.isArray = Array_isArray;
    Array.map = Array_map;
    Array.forEach = Array_forEach;
};
