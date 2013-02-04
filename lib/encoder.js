
/**
 * Module dependencies.
 */

var debug = require('debug')('ogg:encoder');
var binding = require('./binding');
var OggStream = require('./stream');
var inherits = require('util').inherits;
var Readable = require('stream').Readable;

// node v0.8.x compat
if (!Readable) Readable = require('readable-stream');

/**
 * Module exports.
 */

module.exports = Encoder;

/**
 * The `Encoder` class.
 * Welds one or more OggStream instances into a single bitstream.
 */

function Encoder (opts) {
  if (!(this instanceof Encoder)) return new Encoder(opts);
  debug('creating new ogg "Encoder" instance');
  Readable.call(this, opts);
  this.streams = Object.create(null);

  // a queue of OggStreams that is the order in which pageout()/flush() should be
  // called in the _read() callback function
  this._queue = {};
}
inherits(Encoder, Readable);

/**
 * Creates a new OggStream instance and returns it for the user to begin
 * submitting `ogg_packet` instances to it.
 *
 * @param {Number} serialno The serial number of the stream, null/undefined means random.
 * @return {OggStream} the newly created OggStream instance. Call `.packetin()` on it.
 * @api public
 */

Encoder.prototype.stream = function (serialno) {
  debug('stream(%d)', serialno);
  var s = this.streams[serialno];
  if (!s) {
    s = new OggStream(serialno);
    s.on('needPageout', pageout(this));
    s.on('needFlush', flush(this));
    this.streams[s.serialno] = s;
  }
  return s;
};

/**
 * Readable stream base class `_read()` callback function.
 * Processes the _queue array and attempts to read out any available
 * `ogg_page` instances, converted to raw Buffers.
 *
 * @param {Number} bytes
 * @param {Function} done
 * @api private
 */
Encoder.prototype._read = function(bytes, done) {

  if (Object.keys(this.streams).length == 0) {
    return done(null, null);
  }

  var processingStream = [];
  for(var key in this._queue) {
    if(this._queue[key]) {
      processingStream.push(this._queue[key]);
    }
  }
  this._queue = {};

  if(processingStream.length > 0) {
    //we have streams to pageout
    this._processPageout(processingStream, done);
  } else {
    //we have to wait for pageouting
    this._processPageoutLater(done);
  }
};

Encoder.prototype._processPageout = function(streamInfoList, done) {

  var self = this;
  var cnt = 0;
  var bufferList = [];
  var page;
  var buffer;
  
  (function doProcess() {

    var streamInfo = streamInfoList[cnt++];
    if(streamInfo) {
      //process stream
      page = new Buffer(binding.sizeof_ogg_page);
      streamInfo.fn(streamInfo.stream.os, page, afterPageReceived);

    } else {
      //once completed all the streams
      if(bufferList.length > 0) {
        done(null, Buffer.concat(bufferList));
      } else {
        self._processPageoutLater(done);
      }
    }

    function afterPageReceived(r, hlen, blen) {

      if(r == 1) {
        buffer = new Buffer(hlen + blen);
        bufferList.push(buffer);
        binding.ogg_page_to_buffer(page, buffer, doProcess);
      } else if(streamInfo.stream.eos()){
        delete self.streams[item.stream.serialno]
        doProcess();
      } else {
        doProcess();
      }
    }
  })();
};

Encoder.prototype._processPageoutLater = function(callback) {
  
  var self = this;
  this.once('needRead', function() {
    self._read(0, callback);
  });
};

/**
 * Queues a "pageout()" to happen on the next _read() call.
 *
 * @api private
 */

Encoder.prototype._pageout = function (stream, done) {
  debug('_pageout(serialno %d)', stream.serialno);
  this._queue[stream.serialno] = {
    stream: stream,
    fn: binding.ogg_stream_pageout,
    done: done
  };
  this.emit('needRead');
};

/**
 * Queues a "flush()" to happen on the next _read() call.
 *
 * @api private
 */

Encoder.prototype._flush = function (stream, done) {
  debug('_flush(serialno %d)', stream.serialno);
  this._queue[stream.serialno] = {
    stream: stream,
    fn: binding.ogg_stream_flush,
    done: done
  };
  this.emit('needRead');
};

/**
 * Returns an event handler for the "needsPageout" event.
 *
 * @param {Encoder} encoder
 * @api private
 */

function pageout (encoder) {
  return function (done) {
    encoder._pageout(this, done);
  };
};

/**
 * Returns an event handler for the "needsFlush" event.
 *
 * @param {Encoder} encoder
 * @api private
 */

function flush (encoder) {
  return function (done) {
    encoder._flush(this, done);
  };
};
