/**
 * @license
 * File: license.js
 * Copyright (c) 2012-2014, Michael Ihde, All rights reserved.
 * Copyright (c) 2012-2014, Axios Inc., All rights reserved.
 *
 * This file is part of SigPlot.
 * 
 * SigPlot is free software; you can redistribute it and/or modify it under the terms of the GNU Lesser 
 * General Public License as published by the Free Software Foundation; either version 3.0 of the License, or 
 * (at your option) any later version. This library is distributed in the hope that it will be useful, but 
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR 
 * PURPOSE. See the GNU Lesser General Public License for more details. You should have received a copy of the 
 * GNU Lesser General Public License along with SigPlot.
   
 * Portions of SigPlot may utilize the following open-source software:
 *
 *   loglevel.js          - MIT License; Copyright (c) 2014, Tim Perry
 *   typedarray.js        - MIT License; Copyright (c) 2010, Linden Research, Inc.
 *   tinycolor.js         - MIT License; Copyright (c) 2013, Brian Grinstead
 *   CanvasInput.js       - MIT License; Copyright (c) 2013, James Simpson of GoldFire Studios
 *   spin.js              - MIT License; Copyright (c) 2011-2013 Felix Gnass
 *   Array.remove         - MIT License; Copyright (c) 2007, John Resig
 *   Firefox subarray fix - Public Domain; Copyright (c) 2011, Ryan Berdeen
 */

/**
 * @license
 * File: typedarray.js
 * $LicenseInfo:firstyear=2010&license=mit$
 *
 * Copyright (c) 2010, Linden Research, Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 * $/LicenseInfo$
 *
 * Copyright (c) 2013, Michael Ihde - Added big-endian/little-endian support
 */

/*global document*/

//
// ES3/ES5 implementation of the Krhonos TypedArray Working Draft (work in progress):
//   Ref: https://cvs.khronos.org/svn/repos/registry/trunk/public/webgl/doc/spec/TypedArray-spec.html
//   Date: 2011-02-01
//
// Variations:
//  * Float/Double -> Float32/Float64, per WebGL-Public mailing list conversations (post 5/17)
//  * Allows typed_array.get/set() as alias for subscripts (typed_array[])

/**
 * @private
 */
var ArrayBuffer, ArrayBufferView;
var Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array;
var Float32Array, Float64Array;
var DataView;

(function() {
    "use strict";
    /*jslint bitwise: false, nomen: false */

    // Approximations of internal ECMAScript conversion functions
    var ECMAScript = {
        ToInt32: function(v) {
            return v >> 0;
        },
        ToUint32: function(v) {
            return v >>> 0;
        }
    };

    // Raise an INDEX_SIZE_ERR event - intentionally induces a DOM error
    function raise_INDEX_SIZE_ERR() {
        if (document) {
            // raises DOMException(INDEX_SIZE_ERR)
            document.createTextNode("").splitText(1);
        }
        throw new RangeError("INDEX_SIZE_ERR");
    }

    // ES5: lock down object properties
    function configureProperties(obj) {
        if (Object.getOwnPropertyNames && Object.defineProperty) {
            var props = Object.getOwnPropertyNames(obj),
                i;
            for (i = 0; i < props.length; i += 1) {
                Object.defineProperty(obj, props[i], {
                    value: obj[props[i]],
                    writable: false,
                    enumerable: false,
                    configurable: false
                });
            }
        }
    }

    // emulate ES5 getter/setter API using legacy APIs
    // http://blogs.msdn.com/b/ie/archive/2010/09/07/transitioning-existing-code-to-the-es5-getter-setter-apis.aspx
    if (Object.prototype.__defineGetter__ && !Object.defineProperty) {
        Object.defineProperty = function(obj, prop, desc) {
            if (desc.hasOwnProperty('get')) {
                obj.__defineGetter__(prop, desc.get);
            }
            if (desc.hasOwnProperty('set')) {
                obj.__defineSetter__(prop, desc.set);
            }
        };
    }

    // ES5: Make obj[index] an alias for obj._getter(index)/obj._setter(index, value)
    // for index in 0 ... obj.length
    function makeArrayAccessors(obj) {
        if (!Object.defineProperty) {
            return;
        }

        function makeArrayAccessor(index) {
            Object.defineProperty(obj, index, {
                'get': function() {
                    return obj._getter(index);
                },
                'set': function(v) {
                    obj._setter(index, v);
                },
                enumerable: true,
                configurable: false
            });
        }

        var i;
        for (i = 0; i < obj.length; i += 1) {
            makeArrayAccessor(i);
        }
    }

    // Internal conversion functions:
    //    pack<Type>()   - take a number (interpreted as Type), output a byte array
    //    unpack<Type>() - take a byte array, output a Type-like number

    // The original code *only* did big-endian...but often native ArrayBuffers
    // are going to be little-endian...so make little endian the default.

    function be_as_signed(value, bits) {
        var s = 32 - bits;
        return (value << s) >> s;
    }

    function be_as_unsigned(value, bits) {
        var s = 32 - bits;
        return (value << s) >>> s;
    }

    function be_packInt8(n) {
        return [n & 0xff];
    }

    function be_unpackInt8(bytes) {
        return as_signed(bytes[0], 8);
    }

    function be_packUint8(n) {
        return [n & 0xff];
    }

    function be_unpackUint8(bytes) {
        return as_unsigned(bytes[0], 8);
    }

    function be_packInt16(n) {
        return [(n >> 8) & 0xff, n & 0xff];
    }

    function be_unpackInt16(bytes) {
        return as_signed(bytes[0] << 8 | bytes[1], 16);
    }

    function be_packUint16(n) {
        return [(n >> 8) & 0xff, n & 0xff];
    }

    function be_unpackUint16(bytes) {
        return as_unsigned(bytes[0] << 8 | bytes[1], 16);
    }

    function be_packInt32(n) {
        return [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    }

    function be_unpackInt32(bytes) {
        return as_signed(bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3], 32);
    }

    function be_packUint32(n) {
        return [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    }

    function be_unpackUint32(bytes) {
        return as_unsigned(bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3], 32);
    }

    function be_packBits(bits) {
        var bytes = [];
        var str = bits.join('');
        while (str.length) {
            bytes.push(parseInt(str.substring(0, 8), 2));
            str = str.substring(8);
        }
        return bytes;
    }

    function be_unpackBits(bytes) {
        var bits = [],
            i, j;
        for (i = bytes.length; i; i -= 1) {
            b = bytes[i - 1];
            for (j = 8; j; j -= 1) {
                bits.push(b % 2 ? 1 : 0);
                b = b >> 1;
            }
        }
        bits.reverse();
        return bits;
    }

    function le_as_signed(value, bits) {
        var s = 32 - bits;
        return (value << s) >> s;
    }

    function le_as_unsigned(value, bits) {
        var s = 32 - bits;
        return (value << s) >>> s;
    }

    function le_packInt8(n) {
        return [n & 0xff];
    }

    function le_unpackInt8(bytes) {
        return as_signed(bytes[0], 8);
    }

    function le_packUint8(n) {
        return [n & 0xff];
    }

    function le_unpackUint8(bytes) {
        return as_unsigned(bytes[0], 8);
    }

    function le_packInt16(n) {
        return [n & 0xff, (n >> 8) & 0xff];
    }

    function le_unpackInt16(bytes) {
        return as_signed(bytes[1] << 8 | bytes[0], 16);
    }

    function le_packUint16(n) {
        return [n & 0xff, (n >> 8) & 0xff];
    }

    function le_unpackUint16(bytes) {
        return as_unsigned(bytes[1] << 8 | bytes[0], 16);
    }

    function le_packInt32(n) {
        return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
    }

    function le_unpackInt32(bytes) {
        return as_signed(bytes[3] << 24 | bytes[2] << 16 | bytes[1] << 8 | bytes[0], 32);
    }

    function le_packUint32(n) {
        return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
    }

    function le_unpackUint32(bytes) {
        return as_unsigned(bytes[3] << 24 | bytes[2] << 16 | bytes[1] << 8 | bytes[0], 32);
    }

    function le_packBits(bits) {
        var bytes = [];
        var str = bits.join('');
        while (str.length) {
            bytes.push(parseInt(str.substring(str.length - 8, str.length), 2));
            str = str.substring(0, str.length - 8);
        }
        return bytes;
    }

    function le_unpackBits(bytes) {
        var bits = [],
            i, j;
        for (i = 0; i < bytes.length; i++) {
            b = bytes[i];
            for (j = 8; j; j -= 1) {
                bits.push(b % 2 ? 1 : 0);
                b = b >> 1;
            }
        }
        bits.reverse();
        return bits;
    }

    var packInt8 = (!window.BIG_ENDIAN_ARRAYBUFFERS) ? le_packInt8 : be_packInt8;
    var unpackInt8 = (!window.BIG_ENDIAN_ARRAYBUFFERS) ? le_unpackInt8 : be_unpackInt8;

    var packUint8 = (!window.BIG_ENDIAN_ARRAYBUFFERS) ? le_packUint8 : be_packUint8;
    var unpackUint8 = (!window.BIG_ENDIAN_ARRAYBUFFERS) ? le_unpackUint8 : be_unpackUint8;

    var packInt16 = (!window.BIG_ENDIAN_ARRAYBUFFERS) ? le_packInt16 : be_packInt16;
    var unpackInt16 = (!window.BIG_ENDIAN_ARRAYBUFFERS) ? le_unpackInt16 : be_unpackInt16;

    var packUint16 = (!window.BIG_ENDIAN_ARRAYBUFFERS) ? le_packUint16 : be_packUint16;
    var unpackUint16 = (!window.BIG_ENDIAN_ARRAYBUFFERS) ? le_unpackUint16 : be_unpackUint16;

    var packInt32 = (!window.BIG_ENDIAN_ARRAYBUFFERS) ? le_packInt32 : be_packInt32;
    var unpackInt32 = (!window.BIG_ENDIAN_ARRAYBUFFERS) ? le_unpackInt32 : be_unpackInt32;

    var packUint32 = (!window.BIG_ENDIAN_ARRAYBUFFERS) ? le_packUint32 : be_packUint32;
    var unpackUint32 = (!window.BIG_ENDIAN_ARRAYBUFFERS) ? le_unpackUint32 : be_unpackUint32;

    var packBits = (!window.BIG_ENDIAN_ARRAYBUFFERS) ? le_packBits : be_packBits;
    var unpackBits = (!window.BIG_ENDIAN_ARRAYBUFFERS) ? le_unpackBits : be_unpackBits;

    function as_signed(value, bits) {
        var s = 32 - bits;
        return (value << s) >> s;
    }

    function as_unsigned(value, bits) {
        var s = 32 - bits;
        return (value << s) >>> s;
    }

    function packIEEE754(v, ebits, fbits) {

        var bias = (1 << (ebits - 1)) - 1,
            s, e, f, ln,
            i, bits, bytes;

        // Compute sign, exponent, fraction
        if (isNaN(v)) {
            // http://dev.w3.org/2006/webapi/WebIDL/#es-type-mapping
            e = (1 << bias) - 1;
            f = Math.pow(2, fbits - 1);
            s = 0;
        } else if (v === Infinity || v === -Infinity) {
            e = (1 << bias) - 1;
            f = 0;
            s = (v < 0) ? 1 : 0;
        } else if (v === 0) {
            e = 0;
            f = 0;
            s = (1 / v === -Infinity) ? 1 : 0;
        } else {
            s = v < 0;
            v = Math.abs(v);

            if (v >= Math.pow(2, 1 - bias)) {
                // Normalized
                ln = Math.min(Math.floor(Math.log(v) / Math.LN2), bias);
                e = ln + bias;
                f = Math.round(v * Math.pow(2, fbits - ln) - Math.pow(2, fbits));
            } else {
                // Denormalized
                e = 0;
                f = Math.round(v / Math.pow(2, 1 - bias - fbits));
            }
        }

        // Pack sign, exponent, fraction
        bits = [];
        for (i = fbits; i; i -= 1) {
            bits.push(f % 2 ? 1 : 0);
            f = Math.floor(f / 2);
        }
        for (i = ebits; i; i -= 1) {
            bits.push(e % 2 ? 1 : 0);
            e = Math.floor(e / 2);
        }
        bits.push(s ? 1 : 0);
        bits.reverse();

        // Bits to bytes
        var bytes = packBits(bits);
        return bytes;
    }

    function unpackIEEE754(bytes, ebits, fbits) {

        // Bytes to bits
        var bits = [],
            i, j, b, str,
            bias, s, e, f;

        bits = unpackBits(bytes);
        str = bits.join('');

        // Unpack sign, exponent, fraction
        bias = (1 << (ebits - 1)) - 1;
        s = parseInt(str.substring(0, 1), 2) ? -1 : 1;
        e = parseInt(str.substring(1, 1 + ebits), 2);
        f = parseInt(str.substring(1 + ebits), 2);

        // Produce number
        if (e === (1 << ebits) - 1) {
            return f !== 0 ? NaN : s * Infinity;
        } else if (e > 0) {
            // Normalized
            return s * Math.pow(2, e - bias) * (1 + f / Math.pow(2, fbits));
        } else if (f !== 0) {
            // Denormalized
            return s * Math.pow(2, -(bias - 1)) * (f / Math.pow(2, fbits));
        } else {
            return s < 0 ? -0 : 0;
        }
    }

    function unpackFloat64(b) {
        return unpackIEEE754(b, 11, 52);
    }

    function packFloat64(v) {
        return packIEEE754(v, 11, 52);
    }

    function unpackFloat32(b) {
        return unpackIEEE754(b, 8, 23);
    }

    function packFloat32(v) {
        return packIEEE754(v, 8, 23);
    }

    if (!ArrayBuffer) {
        (function() {


            //
            // 3 The ArrayBuffer Type
            //

            ArrayBuffer = function(length) {
                length = ECMAScript.ToInt32(length);
                if (length < 0) {
                    throw new RangeError('ArrayBuffer size is not a small enough positive integer.');
                }

                this.byteLength = length;
                this._bytes = [];
                this._bytes.length = length;

                var i;
                for (i = 0; i < this.byteLength; i += 1) {
                    this._bytes[i] = 0;
                }

                configureProperties(this);
            };

            ArrayBuffer.isNative = false;


            //
            // 4 The ArrayBufferView Type
            //

            // NOTE: this constructor is not exported
            ArrayBufferView = function() {
                //this.buffer = null;
                //this.byteOffset = 0;
                //this.byteLength = 0;
            };

            //
            // 5 The Typed Array View Types
            //

            function makeTypedArrayConstructor(bytesPerElement, pack, unpack) {
                // Each TypedArray type requires a distinct constructor instance with
                // identical logic, which this produces.

                var ctor;
                ctor = function(buffer, byteOffset, length) {
                    var array, sequence, i, s;

                    // Constructor(unsigned long length)
                    if (!arguments.length || typeof arguments[0] === 'number') {
                        this.length = ECMAScript.ToInt32(arguments[0]);
                        if (length < 0) {
                            throw new RangeError('ArrayBufferView size is not a small enough positive integer.');
                        }

                        this.byteLength = this.length * this.BYTES_PER_ELEMENT;
                        this.buffer = new ArrayBuffer(this.byteLength);
                        this.byteOffset = 0;
                    }

                    // Constructor(TypedArray array)
                    else if (typeof arguments[0] === 'object' && arguments[0].constructor === ctor) {
                        array = arguments[0];

                        this.length = array.length;
                        this.byteLength = this.length * this.BYTES_PER_ELEMENT;
                        this.buffer = new ArrayBuffer(this.byteLength);
                        this.byteOffset = 0;

                        for (i = 0; i < this.length; i += 1) {
                            this._setter(i, array._getter(i));
                        }
                    }

                    // Constructor(sequence<type> array)
                    else if (typeof arguments[0] === 'object' && !(arguments[0] instanceof ArrayBuffer)) {
                        sequence = arguments[0];

                        this.length = ECMAScript.ToUint32(sequence.length);
                        this.byteLength = this.length * this.BYTES_PER_ELEMENT;
                        this.buffer = new ArrayBuffer(this.byteLength);
                        this.byteOffset = 0;

                        for (i = 0; i < this.length; i += 1) {
                            s = sequence[i];
                            this._setter(i, Number(s));
                        }
                    }

                    // Constructor(ArrayBuffer buffer,
                    //             optional unsigned long byteOffset, optional unsigned long length)
                    else if (typeof arguments[0] === 'object' && arguments[0] instanceof ArrayBuffer) {
                        this.buffer = buffer;

                        this.byteOffset = ECMAScript.ToUint32(byteOffset);
                        if (this.byteOffset > this.buffer.byteLength) {
                            raise_INDEX_SIZE_ERR(); // byteOffset out of range
                        }

                        if (this.byteOffset % this.BYTES_PER_ELEMENT) {
                            // The given byteOffset must be a multiple of the element
                            // size of the specific type, otherwise an exception is raised.
                            //raise_INDEX_SIZE_ERR();
                            throw new RangeError("ArrayBuffer length minus the byteOffset is not a multiple of the element size.");
                        }

                        if (arguments.length < 3) {
                            this.byteLength = this.buffer.byteLength - this.byteOffset;

                            if (this.byteLength % this.BYTES_PER_ELEMENT) {
                                raise_INDEX_SIZE_ERR(); // length of buffer minus byteOffset not a multiple of the element size
                            }
                            this.length = this.byteLength / this.BYTES_PER_ELEMENT;
                        } else {
                            this.length = ECMAScript.ToUint32(length);
                            this.byteLength = this.length * this.BYTES_PER_ELEMENT;
                        }

                        if ((this.byteOffset + this.byteLength) > this.buffer.byteLength) {
                            raise_INDEX_SIZE_ERR(); // byteOffset and length reference an area beyond the end of the buffer
                        }
                    } else {
                        throw new TypeError("Unexpected argument type(s)");
                    }

                    this.constructor = ctor;

                    // ES5-only magic
                    configureProperties(this);
                    makeArrayAccessors(this);
                };

                ctor.prototype = new ArrayBufferView();
                ctor.prototype.BYTES_PER_ELEMENT = bytesPerElement;
                ctor.prototype.emulated = true;
                ctor.prototype._pack = pack;
                ctor.prototype._unpack = unpack;
                ctor.BYTES_PER_ELEMENT = bytesPerElement;

                // getter type (unsigned long index);
                ctor.prototype._getter = function(index) {
                    if (arguments.length < 1) {
                        throw new SyntaxError("Not enough arguments");
                    }

                    index = ECMAScript.ToUint32(index);
                    if (index >= this.length) {
                        //raise_INDEX_SIZE_ERR(); // Array index out of range
                        return; // undefined
                    }

                    var bytes = [],
                        i, o;
                    for (i = 0, o = this.byteOffset + index * this.BYTES_PER_ELEMENT; i < this.BYTES_PER_ELEMENT; i += 1, o += 1) {
                        bytes.push(this.buffer._bytes[o]);
                    }
                    return this._unpack(bytes);
                };

                // NONSTANDARD: convenience alias for getter: type get(unsigned long index);
                ctor.prototype.get = ctor.prototype._getter;

                // setter void (unsigned long index, type value);
                ctor.prototype._setter = function(index, value) {
                    if (arguments.length < 2) {
                        throw new SyntaxError("Not enough arguments");
                    }

                    index = ECMAScript.ToUint32(index);
                    if (index >= this.length) {
                        //raise_INDEX_SIZE_ERR(); // Array index out of range
                        return;
                    }

                    var bytes = this._pack(value),
                        i, o;
                    for (i = 0, o = this.byteOffset + index * this.BYTES_PER_ELEMENT; i < this.BYTES_PER_ELEMENT; i += 1, o += 1) {
                        this.buffer._bytes[o] = bytes[i];
                    }
                };

                // void set(TypedArray array, optional unsigned long offset);
                // void set(sequence<type> array, optional unsigned long offset);
                ctor.prototype.set = function(index, value) {
                    if (arguments.length < 1) {
                        throw new SyntaxError("Not enough arguments");
                    }
                    var array, sequence, offset, len,
                        i, s, d,
                        byteOffset, byteLength, tmp;

                    // void set(TypedArray array, optional unsigned long offset);
                    if (typeof arguments[0] === 'object' && arguments[0].constructor === this.constructor) {
                        array = arguments[0];
                        offset = ECMAScript.ToUint32(arguments[1]);

                        if (offset + array.length > this.length) {
                            raise_INDEX_SIZE_ERR(); // Offset plus length of array is out of range
                        }

                        byteOffset = this.byteOffset + offset * this.BYTES_PER_ELEMENT;
                        byteLength = array.length * this.BYTES_PER_ELEMENT;

                        if (array.buffer === this.buffer) {
                            tmp = [];
                            for (i = 0, s = array.byteOffset; i < byteLength; i += 1, s += 1) {
                                tmp[i] = array.buffer._bytes[s];
                            }
                            for (i = 0, d = byteOffset; i < byteLength; i += 1, d += 1) {
                                this.buffer._bytes[d] = tmp[i];
                            }
                        } else {
                            for (i = 0, s = array.byteOffset, d = byteOffset; i < byteLength; i += 1, s += 1, d += 1) {
                                this.buffer._bytes[d] = array.buffer._bytes[s];
                            }
                        }
                    }

                    // void set(sequence<type> array, optional unsigned long offset);
                    else if (typeof arguments[0] === 'object' && typeof arguments[0].length !== 'undefined') {
                        sequence = arguments[0];
                        len = ECMAScript.ToUint32(sequence.length);
                        offset = ECMAScript.ToUint32(arguments[1]);

                        if (offset + len > this.length) {
                            raise_INDEX_SIZE_ERR(); // Offset plus length of array is out of range
                        }

                        for (i = 0; i < len; i += 1) {
                            s = sequence[i];
                            this._setter(offset + i, Number(s));
                        }
                    } else {
                        throw new TypeError("Unexpected argument type(s)");
                    }
                };

                // TypedArray subarray(long begin, optional long end);
                ctor.prototype.subarray = function(start, end) {
                    function clamp(v, min, max) {
                        return v < min ? min : v > max ? max : v;
                    }

                    start = ECMAScript.ToInt32(start);
                    end = ECMAScript.ToInt32(end);

                    if (arguments.length < 1) {
                        start = 0;
                    }
                    if (arguments.length < 2) {
                        end = this.length;
                    }

                    if (start < 0) {
                        start = this.length + start;
                    }
                    if (end < 0) {
                        end = this.length + end;
                    }

                    start = clamp(start, 0, this.length);
                    end = clamp(end, 0, this.length);

                    var len = end - start;
                    if (len < 0) {
                        len = 0;
                    }

                    return new this.constructor(this.buffer, start * this.BYTES_PER_ELEMENT, len);
                };

                return ctor;
            }

            Int8Array = Int8Array || makeTypedArrayConstructor(1, packInt8, unpackInt8);
            Uint8Array = Uint8Array || makeTypedArrayConstructor(1, packUint8, unpackUint8);
            Int16Array = Int16Array || makeTypedArrayConstructor(2, packInt16, unpackInt16);
            Uint16Array = Uint16Array || makeTypedArrayConstructor(2, packUint16, unpackUint16);
            Int32Array = Int32Array || makeTypedArrayConstructor(4, packInt32, unpackInt32);
            Uint32Array = Uint32Array || makeTypedArrayConstructor(4, packUint32, unpackUint32);
            Float32Array = Float32Array || makeTypedArrayConstructor(4, packFloat32, unpackFloat32);
            Float64Array = Float64Array || makeTypedArrayConstructor(8, packFloat64, unpackFloat64);

        }());
    }


    if (!DataView) {
        (function() {

            //
            // 6 The DataView View Type
            //

            function r(array, index) {
                if (typeof array.get === 'function') {
                    return array.get(index);
                } else {
                    return array[index];
                }
            }


            var IS_BIG_ENDIAN = (function() {
                var u16array = new Uint16Array([0x1234]),
                    u8array = new Uint8Array(u16array.buffer);
                return r(u8array, 0) === 0x12;
            }());

            // Constructor(ArrayBuffer buffer,
            //             optional unsigned long byteOffset,
            //             optional unsigned long byteLength)
            DataView = function(buffer, byteOffset, byteLength) {
                if (!(typeof buffer === 'object' && buffer instanceof ArrayBuffer)) {
                    throw new TypeError("TypeError");
                }

                this.buffer = buffer;

                this.byteOffset = ECMAScript.ToUint32(byteOffset);
                if (this.byteOffset > this.buffer.byteLength) {
                    raise_INDEX_SIZE_ERR(); // byteOffset out of range
                }

                if (arguments.length < 3) {
                    this.byteLength = this.buffer.byteLength - this.byteOffset;
                } else {
                    this.byteLength = ECMAScript.ToUint32(byteLength);
                }

                if ((this.byteOffset + this.byteLength) > this.buffer.byteLength) {
                    raise_INDEX_SIZE_ERR(); // byteOffset and length reference an area beyond the end of the buffer
                }

                // ES5-only magic
                configureProperties(this);
            };

            if (ArrayBufferView) {
                DataView.prototype = new ArrayBufferView();
            }

            function makeDataView_getter(arrayType) {
                return function(byteOffset, littleEndian) {
                    /*jslint newcap: false*/
                    byteOffset = ECMAScript.ToUint32(byteOffset);

                    if (byteOffset + arrayType.BYTES_PER_ELEMENT > this.byteLength) {
                        raise_INDEX_SIZE_ERR(); // Array index out of range
                    }
                    byteOffset += this.byteOffset;

                    var uint8Array = new Uint8Array(this.buffer, byteOffset, arrayType.BYTES_PER_ELEMENT),
                        bytes = [],
                        i;
                    for (i = 0; i < arrayType.BYTES_PER_ELEMENT; i += 1) {
                        bytes.push(r(uint8Array, i));
                    }

                    if (Boolean(littleEndian) === Boolean(IS_BIG_ENDIAN)) {
                        bytes.reverse();
                    }

                    return r(new arrayType(new Uint8Array(bytes).buffer), 0);
                };
            }

            DataView.prototype.getUint8 = makeDataView_getter(Uint8Array);
            DataView.prototype.getInt8 = makeDataView_getter(Int8Array);
            DataView.prototype.getUint16 = makeDataView_getter(Uint16Array);
            DataView.prototype.getInt16 = makeDataView_getter(Int16Array);
            DataView.prototype.getUint32 = makeDataView_getter(Uint32Array);
            DataView.prototype.getInt32 = makeDataView_getter(Int32Array);
            DataView.prototype.getFloat32 = makeDataView_getter(Float32Array);
            DataView.prototype.getFloat64 = makeDataView_getter(Float64Array);

            function makeDataView_setter(arrayType) {
                return function(byteOffset, value, littleEndian) {
                    /*jslint newcap: false*/
                    byteOffset = ECMAScript.ToUint32(byteOffset);
                    if (byteOffset + arrayType.BYTES_PER_ELEMENT > this.byteLength) {
                        raise_INDEX_SIZE_ERR(); // Array index out of range
                    }

                    // Get bytes
                    var typeArray = new arrayType([value]),
                        byteArray = new Uint8Array(typeArray.buffer),
                        bytes = [],
                        i, byteView;

                    for (i = 0; i < arrayType.BYTES_PER_ELEMENT; i += 1) {
                        bytes.push(r(byteArray, i));
                    }

                    // Flip if necessary
                    if (Boolean(littleEndian) === Boolean(IS_BIG_ENDIAN)) {
                        bytes.reverse();
                    }

                    // Write them
                    byteView = new Uint8Array(this.buffer, byteOffset, arrayType.BYTES_PER_ELEMENT);
                    byteView.set(bytes);
                };
            }

            DataView.prototype.setUint8 = makeDataView_setter(Uint8Array);
            DataView.prototype.setInt8 = makeDataView_setter(Int8Array);
            DataView.prototype.setUint16 = makeDataView_setter(Uint16Array);
            DataView.prototype.setInt16 = makeDataView_setter(Int16Array);
            DataView.prototype.setUint32 = makeDataView_setter(Uint32Array);
            DataView.prototype.setInt32 = makeDataView_setter(Int32Array);
            DataView.prototype.setFloat32 = makeDataView_setter(Float32Array);
            DataView.prototype.setFloat64 = makeDataView_setter(Float64Array);

        }());
    }

}());

/**
 * @license
 * File: common.js
 * Copyright (c) 2012-2014, Michael Ihde, All rights reserved.
 * Copyright (c) 2012-2014, Axios Inc., All rights reserved.
 *
 * This file is part of SigPlot.
 *
 * SigPlot is free software; you can redistribute it and/or modify it under the terms of the GNU Lesser
 * General Public License as published by the Free Software Foundation; either version 3.0 of the License, or
 * (at your option) any later version. This library is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE. See the GNU Lesser General Public License for more details. You should have received a copy of the
 * GNU Lesser General Public License along with SigPlot.
 *
 */


if (window.ArrayBuffer) {
    if (!ArrayBuffer.prototype.slice) {
        //Monkey Patching for iOS and early Firefox
        ArrayBuffer.prototype.slice = function(start, end) {
            var that = new Uint8Array(this);
            if (end === undefined) {
                end = that.length;
            }
            var result = new ArrayBuffer(end - start);
            var resultArray = new Uint8Array(result);
            for (var i = 0; i < resultArray.length; i++) {
                resultArray[i] = that[i + start];
            }
            return result;
        };
    }
}

//Array Remove - By John Resig (MIT Licensed)
Array.prototype.remove = function(from, to) {
    var rest = this.slice((to || from) + 1 || this.length);
    this.length = from < 0 ? this.length + from : from;
    return this.push.apply(this, rest);
};

// Shim for requestAnimationFrame compatibility
window.requestAnimFrame = (function(callback) {
    return window.requestAnimationFrame || window.webkitRequestAnimationFrame || window.mozRequestAnimationFrame || window.oRequestAnimationFrame || window.msRequestAnimationFrame ||
        function(callback) {
            return window.setTimeout(callback, 1000 / 60);
    };
})();

window.cancelAnimFrame = (function(callback) {
    return window.cancelAnimationFrame || window.webkitCancelAnimationFrame || window.mozCancelAnimationFrame || window.oCancelAnimationFrame || window.msCanelAnimationFrame ||
        function(timeoutID) {
            window.clearTimeout(timeoutID);
    };
})();

// Handle various ways to draw dashed lines
function dashOn(ctx, on, off) {
    if (ctx.setLineDash) {
        ctx.setLineDash([on, off]);
        return true;
    } else if (ctx.mozDash !== undefined) { // Gecko 7.0+
        ctx.mozDash = [on, off];
        return true;
    } else if (ctx.webkitLineDash && ctx.webkitLineDash.length === 0) {
        ctx.webkitLineDash = [on, off];
        return true;
    }
    return false;
}

function dashOff(ctx) {
    if (ctx.setLineDash) {
        ctx.setLineDash([]);
    } else if (ctx.mozDash) { // Gecko 7.0+
        ctx.mozDash = null;
    } else if (ctx.webkitLineDash) {
        ctx.webkitLineDash = [];
    }
}

// Firefox behaves differntly for keypress events
function getKeyCode(e) {
    e = window.event || e;
    e = e.charCode || e.keyCode;
    return e;
}

function setKeypressHandler(handler) {
    if (window.addEventListener) { window.addEventListener('keypress', handler, false); }
    else if (window.attachEvent) {
        window.attachEvent('onkeypress', handler);
    }
}

// Array.isArray
// FF 4+
// IE 9+
// SF 5+
// http://kangax.github.io/es5-compat-table/#Array.isArray
if (!Array.isArray) {
    Array.isArray = function(obj) {
        return Object.prototype.toString.call(obj) === "[object Array]";
    };
}

if (!window.Float64Array) {
    //Monkey Patching for iOS
    // This is essentially ReadOnly because
    // if someone does x[i] = 5
    // the value will be set in the array
    // but not in the underlying buffer
    window.Float64Array = (function() {
        return window.Float64Array ||
            function(buffer, byteOffset, length) {
                if (!(buffer instanceof ArrayBuffer)) {
                    throw "Invalid type";
                }
                var dv = new DataView(buffer);
                var b = [];
                var maxlength = (buffer.byteLength - byteOffset) / 8;
                if (length === undefined) {
                    b.length = maxlength;
                } else {
                    b.length = Math.min(length, maxlength);
                }

                for (var i = 0; i < b.length; i++) {
                    b[i] = dv.getFloat64(i * 8 + byteOffset, true);
                }
                b.subarray = function(begin, end) {
                    return b.slice(begin, end);
                };
                return b;
        };
    })();
}

// Shims
(function() {
    /* console shim*/
    var f = function() {};
    if (!window.console) {
        window.console = {
            log: f,
            info: f,
            warn: f,
            debug: f,
            error: f
        };
    }

    // Firefox 4 has a glaring subarray bug
    // http://ryanberdeen.com/2011/04/16/firefox-subarray-bug.html
    if (new Int8Array([0, 1, 0]).subarray(1).subarray(1)[0]) {
        var subarray = function(begin, end) {
            if (arguments.length === 0) {
                begin = 0;
                end = this.length;
            } else {
                if (begin < 0) {
                    // relative to end
                    begin += this.length;
                }
                // clamp to 0, length
                begin = Math.max(0, Math.min(this.length, begin));
                if (arguments.length === 1) {
                    // slice to end
                    end = this.length;
                } else {
                    if (end < 0) {
                        // relative to end
                        end += this.length;
                    }
                    // clamp to begin, length
                    end = Math.max(begin, Math.min(this.length, end));
                }
            }

            var byteOffset = this.byteOffset + begin * this.BYTES_PER_ELEMENT;
            return new this.constructor(this.buffer, byteOffset, end - begin);
        };

        var typedArrays = [Int8Array, Uint8Array, Int16Array, Uint16Array,
            Int32Array, Uint32Array, Float32Array, Float64Array
        ];
        typedArrays.forEach(function(cls) {
            cls.prototype.subarray = subarray;
        });
    }

}());

// https://developer.mozilla.org/en-US/docs/Web/Reference/Events/wheel?redirectlocale=en-US&redirectslug=DOM%2FMozilla_event_reference%2Fwheel#Listening_to_this_event_across_browser
// creates a global "addWheelListener" method
// example: addWheelListener( elem, function( e ) { console.log( e.deltaY ); e.preventDefault(); } );
(function(window, document) {

    var prefix = "",
        _addEventListener, onwheel, support;

    // detect event model
    if (window.addEventListener) {
        _addEventListener = "addEventListener";
    } else {
        _addEventListener = "attachEvent";
        prefix = "on";
    }

    // detect available wheel event
    support = "onwheel" in document.createElement("div") ? "wheel" : // Modern browsers support "wheel"
    document.onmousewheel !== undefined ? "mousewheel" : // Webkit and IE support at least "mousewheel"
    "DOMMouseScroll"; // let's assume that remaining browsers are older Firefox

    window.addWheelListener = function(elem, callback, useCapture) {
        _addWheelListener(elem, support, callback, useCapture);

        // handle MozMousePixelScroll in older Firefox
        if (support === "DOMMouseScroll") {
            _addWheelListener(elem, "MozMousePixelScroll", callback, useCapture);
        }
    };

    /* jshint -W030 */
    function _addWheelListener(elem, eventName, callback, useCapture) {
        elem[_addEventListener](prefix + eventName, support === "wheel" ? callback : function(originalEvent) {
            !originalEvent && (originalEvent = window.event);

            // create a normalized event object
            var event = {
                // keep a ref to the original event object
                originalEvent: originalEvent,
                target: originalEvent.target || originalEvent.srcElement,
                type: "wheel",
                deltaMode: originalEvent.type === "MozMousePixelScroll" ? 0 : 1,
                deltaX: 0,
                delatZ: 0,
                preventDefault: function() {
                    originalEvent.preventDefault ?
                        originalEvent.preventDefault() :
                        originalEvent.returnValue = false;
                }
            };

            // calculate deltaY (and deltaX) according to the event
            if (support === "mousewheel") {
                event.deltaY = -1 / 40 * originalEvent.wheelDelta;
                // Webkit also support wheelDeltaX
                originalEvent.wheelDeltaX && (event.deltaX = -1 / 40 * originalEvent.wheelDeltaX);
            } else {
                event.deltaY = originalEvent.detail;
            }

            // it's time to fire the callback
            return callback(event);

        }, useCapture || false);
    }
    /* jshint +W030 */

})(window, document);

/**
 * @license
 * File: bluefile.js
 * Copyright (c) 2012-2014, Michael Ihde, All rights reserved.
 * Copyright (c) 2012-2014, Axios Inc., All rights reserved.
 *
 * This file is part of SigPlot.
 *
 * SigPlot is free software; you can redistribute it and/or modify it under the terms of the GNU Lesser
 * General Public License as published by the Free Software Foundation; either version 3.0 of the License, or
 * (at your option) any later version. This library is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE. See the GNU Lesser General Public License for more details. You should have received a copy of the
 * GNU Lesser General Public License along with SigPlot.
 *
 */

/**
 * Bluefiles are a binary format directly supported by SigPlot.  A Bluefile consists of a 512-byte header
 * followed by binary data.
 * For more information on BLUEFILES, please visit http://nextmidas.techma.com/nm/htdocs/usersguide/BlueFiles.html
 *
 * Offset	Name		Size	Type		Description
 * -----------------------------------------------------------------------------
 * 0 		version 	4 	char[4] 	Header version
 * 4 		head_rep 	4 	char[4] 	Header representation
 * 8 		data_rep 	4 	char[4] 	Data representation
 *12 		detached 	4 	int_4 		Detached header
 *16 		protected 	4 	int_4 		Protected from overwrite
 *20 		pipe 		4 	int_4 		Pipe mode (N/A)
 *24 		ext_start 	4 	int_4 		Extended header start, in 512-byte blocks
 *28 		ext_size 	4 	int_4 		Extended header size in bytes
 *32 		data_start 	8 	real_8 		Data start in bytes
 *40 		data_size 	8 	real_8 		Data size in bytes
 *48 		type 		4 	int_4 		File type code
 *52 		format 		2 	char[2] 	Data format code
 *54 		flagmask 	2 	int_2 		16-bit flagmask (1=flagbit)
 *56 		timecode 	8 	real_8 		Time code field
 *64 		inlet 		2 	int_2 		Inlet owner
 *66 		outlets 	2 	int_2 		Number of outlets
 *68 		outmask 	4 	int_4 		Outlet async mask
 *72 		pipeloc 	4 	int_4 		Pipe location
 *76 		pipesize 	4 	int_4 		Pipe size in bytes
 *80 		in_byte 	8 	real_8 		Next input byte
 *88 		out_byte 	8 	real_8 		Next out byte (cumulative)
 *96 		outbytes 	64 	real_8[8] 	Next out byte (each outlet)
 *160 		keylength 	4 	int_4 		Length of keyword string
 *164 		keywords 	92 	char[92] 	User defined keyword string
 *256 		Adjunct 	256 	char[256] 	Type-specific adjunct union (See below for 1000 and 2000 type bluefiles)
 *
 *
 * Type-1000 Adjunct
 * 0 		xstart 		8 	real_8 		Abscissa value for first sample
 *8 		xdelta 		8 	real_8 		Abscissa interval between samples
 *16 		xunits 		4 	int_4 		Units for abscissa values
 *
 * Type-2000 Adjunct
 *0 		xstart 		8 	real_8 		Frame (column) starting value
 *8 		xdelta 		8 	real_8 		Increment between samples in frame
 *16 		xunits 		4 	int_4 		Frame (column) units
 *20 		subsize 	4 	int_4 		Number of data points per frame (row)
 *24 		ystart 		8 	real_8 		Abscissa (row) start
 *32 		ydelta 		8 	real_8 		Increment between frames
 *36 		yunits 		4 	int_4 		Abscissa (row) unit code
 *
 * @namespace bluefile
 */
(function(global) {
    'use strict';

    /**
     * @memberOf bluefile
     * @private
     */
    var iOS = (navigator.userAgent.match(/(iPad|iPhone|iPod)/i) ? true : false);



    // https://gist.github.com/TooTallNate/4750953
    /**
     * @memberof bluefile
     * @private
     */
    function endianness() {
        var b = new ArrayBuffer(4);
        var a = new Uint32Array(b);
        var c = new Uint8Array(b);
        a[0] = 0xdeadbeef;
        if (c[0] === 0xef) { return 'LE'; }
        if (c[0] === 0xde) { return 'BE'; }
        throw new Error('unknown endianness');
    }




    /**
     * @memberOf bluefile
     * @private
     */
    var ARRAY_BUFFER_ENDIANNESS = endianness();



    /**
     * @memberOf bluefile
     * @private
     */
    var _SPA = {
        'S': 1,
        'C': 2,
        'V': 3,
        'Q': 4,
        'M': 9,
        'X': 10,
        'T': 16,
        'U': 1,
        '1': 1,
        '2': 2,
        '3': 3,
        '4': 4,
        '5': 5,
        '6': 6,
        '7': 7,
        '8': 8,
        '9': 9
    };



    /**
     * @memberOf bluefile
     * @private
     */
    var _BPS = {
        'P': 0.125,
        'A': 1,
        'O': 1,
        'B': 1,
        'I': 2,
        'L': 4,
        'X': 8,
        'F': 4,
        'D': 8
    };



    /**
     * @memberOf bluefile
     * @private
     */
    var _XM_TO_TYPEDARRAY = {
        'P': null,
        'A': null,
        'O': Uint8Array,
        'B': Int8Array,
        'I': Int16Array,
        'L': Int32Array,
        'X': null,
        'F': Float32Array,
        'D': Float64Array
    };



    /**
     * @memberOf bluefile
     * @private
     */
    var _applySupportsTypedArray = true;
    try {
        var uintbuf = new UInt8Array(new ArrayBuffer(4));
        uintbuf[0] = 66;
        uintbuf[1] = 76;
        uintbuf[2] = 85;
        uintbuf[3] = 69;
        var test = String.fromCharCode.apply(null, uintbuf);
        if (test !== "BLUE") {
            _applySupportsTypedArray = false;
        }
    } catch (error) {
        _applySupportsTypedArray = false;
    }



    /**
     * @memberof bluefile
     * @param 	{array} 	buf 		Data bffer
     * @private
     */
    function ab2str(buf) {
        var uintbuf = new Uint8Array(buf);
        // Firefox 3.6 nor iOS devices can use ArrayBuffers with .apply
        if (_applySupportsTypedArray) {
            return String.fromCharCode.apply(null, uintbuf);
        } else {
            var str = "";
            for (var i = 0; i < uintbuf.length; i++) {
                str += String.fromCharCode(uintbuf[i]);
            }
            return str;
        }
    }

    /**
     * Create bluefile header and attach data buffer
     * @memberof bluefile
     * @param 	{array} 	buf 		Data bffer
     */
    function BlueHeader(buf) {
        this.file = null;
        this.file_name = null;
        this.offset = 0;
        this.buf = buf;
        if (this.buf != null) {
            var dvhdr = new DataView(this.buf);
            this.version = ab2str(this.buf.slice(0, 4));
            this.headrep = ab2str(this.buf.slice(4, 8));
            this.datarep = ab2str(this.buf.slice(8, 12));
            var littleEndianHdr = (this.headrep === "EEEI");
            var littleEndianData = (this.datarep === "EEEI");
            this.type = dvhdr.getUint32(48, littleEndianHdr);
            this["class"] = this.type / 1000;
            this.format = ab2str(this.buf.slice(52, 54));
            this.timecode = dvhdr.getFloat64(56, littleEndianHdr);

            // the adjunct starts at offset 0x100
            if (this["class"] === 1) {
                this.xstart = dvhdr.getFloat64(0x100, littleEndianHdr);
                this.xdelta = dvhdr.getFloat64(0x100 + 8, littleEndianHdr);
                this.xunits = dvhdr.getInt32(0x100 + 16, littleEndianHdr);
                this.subsize = 1;
            } else if (this["class"] === 2) {
                this.xstart = dvhdr.getFloat64(0x100, littleEndianHdr);
                this.xdelta = dvhdr.getFloat64(0x100 + 8, littleEndianHdr);
                this.xunits = dvhdr.getInt32(0x100 + 16, littleEndianHdr);
                this.subsize = dvhdr.getInt32(0x100 + 20, littleEndianHdr);
                this.ystart = dvhdr.getFloat64(0x100 + 24, littleEndianHdr);
                this.ydelta = dvhdr.getFloat64(0x100 + 32, littleEndianHdr);
                this.yunits = dvhdr.getInt32(0x100 + 40, littleEndianHdr);
            }

            this.data_start = dvhdr.getFloat64(32, littleEndianHdr);
            this.data_size = dvhdr.getFloat64(40, littleEndianHdr);
            var ds = this.data_start;
            var de = this.data_start + this.data_size;
            this.setData(this.buf, ds, de, littleEndianData);
        }
    }

    BlueHeader.prototype = {
        /**
         * @memberof bluefile
         * @param 	buf
         * @param 	offset
         * @param 	data_end
         * @param 	littleEndian
         *
         */
        setData: function(buf, offset, data_end, littleEndian) {
            if (this["class"] === 1) {
                this.spa = _SPA[this.format[0]];
                this.bps = _BPS[this.format[1]];
                this.bpa = this.spa * this.bps;
                this.ape = 1;
                this.bpe = this.ape * this.bpa;
            } else if (this["class"] === 2) {
                this.spa = _SPA[this.format[0]];
                this.bps = _BPS[this.format[1]];
                this.bpa = this.spa * this.bps;
                this.ape = this.subsize;
                this.bpe = this.ape * this.bpa;
            }

            if (littleEndian === undefined) {
                littleEndian = (ARRAY_BUFFER_ENDIANNESS === "LE");
            }

            // TODO handle mismatch between host and data endianness using arrayBufferEndianness
            if (ARRAY_BUFFER_ENDIANNESS === "LE" && !littleEndian) {
                throw ("Not supported " + ARRAY_BUFFER_ENDIANNESS + " " + littleEndian);
            } else if (ARRAY_BUFFER_ENDIANNESS === "BE" && this.littleEndianData) {
                throw ("Not supported " + ARRAY_BUFFER_ENDIANNESS + " " + littleEndian);
            }

            if (buf) {
                if ((offset) && (data_end)) {
                    this.dview = this.createArray(buf, offset, (data_end - offset) / this.bps);
                } else {
                    this.dview = this.createArray(buf);
                }
                this.size = this.dview.length / (this.spa * this.ape);
            } else {
                this.dview = this.createArray(null, null, this.size);
            }
        },

        /**
         * Create typed array
         * @memberof bluefile
         * @param 	buf
         * @param 	offset
         * @param 	length
         * @returns -
         */
        createArray: function(buf, offset, length) {
            var TypedArray = _XM_TO_TYPEDARRAY[this.format[1]];
            if (TypedArray === undefined) {
                throw ("unknown format " + this.format[1]);
            }
            // backwards compatibility with some implementations of typed array
            // requires this
            if (offset === undefined) {
                offset = 0;
            }
            if (length === undefined) {
                length = buf.length || (buf.byteLength / _BPS[this.format[1]]);
            }

            if (buf) {
                return new TypedArray(buf, offset, length);
            } else {
                return new TypedArray(length);
            }
        }
    };


    // Internal method from http://james.padolsey.com/javascript/parsing-urls-with-the-dom/
    /**
     * This function creates a new anchor element and uses location
     * properties (inherent) to get the desired URL data. Some String
     * operations are used (to normalize results across browsers).
     *
     * @memberof bluefile
     * @private
     * @param 	url
     * @returns -
     */
    function parseURL(url) {
        var a = document.createElement('a');
        a.href = url;
        return {
            source: url,
            protocol: a.protocol.replace(':', ''),
            host: a.hostname,
            port: a.port,
            query: a.search,
            params: (function() {
                var ret = {},
                    seg = a.search.replace(/^\?/, '').split('&'),
                    len = seg.length,
                    i = 0,
                    s;
                for (; i < len; i++) {
                    if (!seg[i]) {
                        continue;
                    }
                    s = seg[i].split('=');
                    ret[s[0]] = s[1];
                }
                return ret;
            })(),
            file: (a.pathname.match(/\/([^\/?#]+)$/i) || [null, ''])[1],
            hash: a.hash.replace('#', ''),
            path: a.pathname.replace(/^([^\/])/, '/$1'),
            relative: (a.href.match(/tps?:\/\/[^\/]+(.+)/) || [null, ''])[1],
            segments: a.pathname.replace(/^\//, '').split('/')
        };
    }

    /**
     * @memberof bluefile
     * @private
     * @param 	text
     * @param	oncomplete
     * @param 	blocksize
     */
    function text2buffer(text, oncomplete, blocksize) {
        blocksize = blocksize || 1024;
        var i = 0;
        var arrayBuffer = new ArrayBuffer(text.length);
        var bufView = new Uint8Array(arrayBuffer);
        var worker = function() {
            var end = i + blocksize;
            for (; i < end; i++) {
                bufView[i] = (text.charCodeAt(i) & 0xff);
            }
            if (i >= text.length) {
                oncomplete(arrayBuffer);
            } else {
                setTimeout(worker, 0);
            }
        };
        setTimeout(worker, 0);
    }


    /**
     * Bluefile Reader
     * @memberof	bluefile
     * @param 	options
     */
    function BlueFileReader(options) {
        this.options = options;
    }

    BlueFileReader.prototype = {

        /**
         * @memberof bluefile
         * @param 	theFile
         * @param 	onload
         *
         */
        readheader: function readheader(theFile, onload) {
            var reader = new FileReader();
            var blob = theFile.webkitSlice(0, 512); // Chrome specific

            // Closure to capture the file information.
            reader.onloadend = (function(theFile) {
                return function(e) {
                    if (e.target.error) {
                        onload(null);
                        return;
                    }

                    var rawhdr = reader.result;
                    var hdr = new BlueHeader(rawhdr);
                    hdr.file = theFile;
                    onload(hdr);
                };
            })(theFile);

            reader.readAsArrayBuffer(blob);
        },

        /**
         *
         * @memberof bluefile
         * @param	theFile
         * @param	onload
         *
         */
        read: function read(theFile, onload) {
            var reader = new FileReader();

            // Closure to capture the file information.
            reader.onloadend = (function(theFile) {
                return function(e) {
                    if (e.target.error) {
                        onload(null);
                        return;
                    }

                    var raw = reader.result;
                    var hdr = new BlueHeader(raw);
                    hdr.file = theFile;
                    hdr.file_name = theFile.name;
                    onload(hdr);
                };
            })(theFile);

            reader.readAsArrayBuffer(theFile);
        },


        /**
         *
         * @memberof bluefile
         * @param	href
         * @param	onload
         *
         */
        read_http: function read_http(href, onload) {
            var oReq = new XMLHttpRequest();
            oReq.open("GET", href, true);
            oReq.responseType = "arraybuffer";
            oReq.overrideMimeType('text\/plain; charset=x-user-defined');
            oReq.onload = function(oEvent) {
                if (oReq.readyState === 4) {
                    if ((oReq.status === 200) || (oReq.status === 0)) { // status = 0 is necessary for file URL
                        var arrayBuffer = null; // Note: not oReq.responseText
                        if (oReq.response) {
                            arrayBuffer = oReq.response;
                            var hdr = new BlueHeader(arrayBuffer);
                            parseURL(href);
                            var fileUrl = parseURL(href);
                            hdr.file_name = fileUrl.file;
                            onload(hdr);
                        } else if (oReq.responseText) {
                            text2buffer(oReq.responseText, function(arrayBuffer) {
                                var hdr = new BlueHeader(arrayBuffer);
                                parseURL(href);
                                var fileUrl = parseURL(href);
                                hdr.file_name = fileUrl.file;
                                onload(hdr);
                            });
                        }
                        return;
                    }
                }
                onload(null);
            };

            oReq.onerror = function(oEvent) {
                onload(null);
            };

            oReq.send(null);
        }

    };

    global['BlueHeader'] = global['BlueHeader'] || BlueHeader;
    global['BlueFileReader'] = global['BlueFileReader'] || BlueFileReader;
}(this));

/**
 * @license
 * File: tinycolor.js
 * TinyColor v0.9.15+
 * https://github.com/bgrins/TinyColor
 * 2013-02-24, Brian Grinstead, MIT License
 */

(function(root) {

    var trimLeft = /^[\s,#]+/,
        trimRight = /\s+$/,
        tinyCounter = 0,
        math = Math,
        mathRound = math.round,
        mathMin = math.min,
        mathMax = math.max,
        mathRandom = math.random;

    function tinycolor(color, opts) {

        color = (color) ? color : '';
        opts = opts || {};

        // If input is already a tinycolor, return itself
        if (typeof color == "object" && color.hasOwnProperty("_tc_id")) {
            return color;
        }

        var rgb = inputToRGB(color);
        var r = rgb.r,
            g = rgb.g,
            b = rgb.b,
            a = rgb.a,
            roundA = mathRound(100 * a) / 100,
            format = opts.format || rgb.format;

        // Don't let the range of [0,255] come back in [0,1].
        // Potentially lose a little bit of precision here, but will fix issues where
        // .5 gets interpreted as half of the total, instead of half of 1
        // If it was supposed to be 128, this was already taken care of by `inputToRgb`
        if (r < 1) {
            r = mathRound(r);
        }
        if (g < 1) {
            g = mathRound(g);
        }
        if (b < 1) {
            b = mathRound(b);
        }

        return {
            ok: rgb.ok,
            format: format,
            _tc_id: tinyCounter++,
            alpha: a,
            toHsv: function() {
                var hsv = rgbToHsv(r, g, b);
                return {
                    h: hsv.h * 360,
                    s: hsv.s,
                    v: hsv.v,
                    a: a
                };
            },
            toHsvString: function() {
                var hsv = rgbToHsv(r, g, b);
                var h = mathRound(hsv.h * 360),
                    s = mathRound(hsv.s * 100),
                    v = mathRound(hsv.v * 100);
                return (a == 1) ?
                    "hsv(" + h + ", " + s + "%, " + v + "%)" :
                    "hsva(" + h + ", " + s + "%, " + v + "%, " + roundA + ")";
            },
            toHsl: function() {
                var hsl = rgbToHsl(r, g, b);
                return {
                    h: hsl.h * 360,
                    s: hsl.s,
                    l: hsl.l,
                    a: a
                };
            },
            toHslString: function() {
                var hsl = rgbToHsl(r, g, b);
                var h = mathRound(hsl.h * 360),
                    s = mathRound(hsl.s * 100),
                    l = mathRound(hsl.l * 100);
                return (a == 1) ?
                    "hsl(" + h + ", " + s + "%, " + l + "%)" :
                    "hsla(" + h + ", " + s + "%, " + l + "%, " + roundA + ")";
            },
            toHex: function(allow3Char) {
                return rgbToHex(r, g, b, allow3Char);
            },
            toHexString: function(allow3Char) {
                return '#' + rgbToHex(r, g, b, allow3Char);
            },
            toRgb: function() {
                return {
                    r: mathRound(r),
                    g: mathRound(g),
                    b: mathRound(b),
                    a: a
                };
            },
            toRgbString: function() {
                return (a == 1) ?
                    "rgb(" + mathRound(r) + ", " + mathRound(g) + ", " + mathRound(b) + ")" :
                    "rgba(" + mathRound(r) + ", " + mathRound(g) + ", " + mathRound(b) + ", " + roundA + ")";
            },
            toPercentageRgb: function() {
                return {
                    r: mathRound(bound01(r, 255) * 100) + "%",
                    g: mathRound(bound01(g, 255) * 100) + "%",
                    b: mathRound(bound01(b, 255) * 100) + "%",
                    a: a
                };
            },
            toPercentageRgbString: function() {
                return (a == 1) ?
                    "rgb(" + mathRound(bound01(r, 255) * 100) + "%, " + mathRound(bound01(g, 255) * 100) + "%, " + mathRound(bound01(b, 255) * 100) + "%)" :
                    "rgba(" + mathRound(bound01(r, 255) * 100) + "%, " + mathRound(bound01(g, 255) * 100) + "%, " + mathRound(bound01(b, 255) * 100) + "%, " + roundA + ")";
            },
            toName: function() {
                if (a === 0) {
                    return "transparent";
                }

                return hexNames[rgbToHex(r, g, b, true)] || false;
            },
            toFilter: function(secondColor) {
                var hex = rgbToHex(r, g, b);
                var secondHex = hex;
                var alphaHex = Math.round(parseFloat(a) * 255).toString(16);
                var secondAlphaHex = alphaHex;
                var gradientType = opts && opts.gradientType ? "GradientType = 1, " : "";

                if (secondColor) {
                    var s = tinycolor(secondColor);
                    secondHex = s.toHex();
                    secondAlphaHex = Math.round(parseFloat(s.alpha) * 255).toString(16);
                }

                return "progid:DXImageTransform.Microsoft.gradient(" + gradientType + "startColorstr=#" + pad2(alphaHex) + hex + ",endColorstr=#" + pad2(secondAlphaHex) + secondHex + ")";
            },
            toString: function(format) {
                var formatSet = !! format;
                format = format || this.format;

                var formattedString = false;
                var hasAlphaAndFormatNotSet = !formatSet && a < 1 && a > 0;
                var formatWithAlpha = hasAlphaAndFormatNotSet && (format === "hex" || format === "hex6" || format === "hex3" || format === "name");

                if (format === "rgb") {
                    formattedString = this.toRgbString();
                }
                if (format === "prgb") {
                    formattedString = this.toPercentageRgbString();
                }
                if (format === "hex" || format === "hex6") {
                    formattedString = this.toHexString();
                }
                if (format === "hex3") {
                    formattedString = this.toHexString(true);
                }
                if (format === "name") {
                    formattedString = this.toName();
                }
                if (format === "hsl") {
                    formattedString = this.toHslString();
                }
                if (format === "hsv") {
                    formattedString = this.toHsvString();
                }

                if (formatWithAlpha) {
                    return this.toRgbString();
                }

                return formattedString || this.toHexString();
            }
        };
    }

    // If input is an object, force 1 into "1.0" to handle ratios properly
    // String input requires "1.0" as input, so 1 will be treated as 1
    tinycolor.fromRatio = function(color, opts) {
        if (typeof color == "object") {
            var newColor = {};
            for (var i in color) {
                if (color.hasOwnProperty(i)) {
                    if (i === "a") {
                        newColor[i] = color[i];
                    } else {
                        newColor[i] = convertToPercentage(color[i]);
                    }
                }
            }
            color = newColor;
        }

        return tinycolor(color, opts);
    };

    // Given a string or object, convert that input to RGB
    // Possible string inputs:
    //
    //     "red"
    //     "#f00" or "f00"
    //     "#ff0000" or "ff0000"
    //     "rgb 255 0 0" or "rgb (255, 0, 0)"
    //     "rgb 1.0 0 0" or "rgb (1, 0, 0)"
    //     "rgba (255, 0, 0, 1)" or "rgba 255, 0, 0, 1"
    //     "rgba (1.0, 0, 0, 1)" or "rgba 1.0, 0, 0, 1"
    //     "hsl(0, 100%, 50%)" or "hsl 0 100% 50%"
    //     "hsla(0, 100%, 50%, 1)" or "hsla 0 100% 50%, 1"
    //     "hsv(0, 100%, 100%)" or "hsv 0 100% 100%"
    //
    function inputToRGB(color) {

        var rgb = {
            r: 0,
            g: 0,
            b: 0
        };
        var a = 1;
        var ok = false;
        var format = false;

        if (typeof color == "string") {
            color = stringInputToObject(color);
        }

        if (typeof color == "object") {
            if (color.hasOwnProperty("r") && color.hasOwnProperty("g") && color.hasOwnProperty("b")) {
                rgb = rgbToRgb(color.r, color.g, color.b);
                ok = true;
                format = String(color.r).substr(-1) === "%" ? "prgb" : "rgb";
            } else if (color.hasOwnProperty("h") && color.hasOwnProperty("s") && color.hasOwnProperty("v")) {
                color.s = convertToPercentage(color.s);
                color.v = convertToPercentage(color.v);
                rgb = hsvToRgb(color.h, color.s, color.v);
                ok = true;
                format = "hsv";
            } else if (color.hasOwnProperty("h") && color.hasOwnProperty("s") && color.hasOwnProperty("l")) {
                color.s = convertToPercentage(color.s);
                color.l = convertToPercentage(color.l);
                rgb = hslToRgb(color.h, color.s, color.l);
                ok = true;
                format = "hsl";
            }

            if (color.hasOwnProperty("a")) {
                a = color.a;
            }
        }

        a = parseFloat(a);

        // Handle invalid alpha characters by setting to 1
        if (isNaN(a) || a < 0 || a > 1) {
            a = 1;
        }

        return {
            ok: ok,
            format: color.format || format,
            r: mathMin(255, mathMax(rgb.r, 0)),
            g: mathMin(255, mathMax(rgb.g, 0)),
            b: mathMin(255, mathMax(rgb.b, 0)),
            a: a
        };
    }


    // Conversion Functions
    // --------------------

    // `rgbToHsl`, `rgbToHsv`, `hslToRgb`, `hsvToRgb` modified from:
    // <http://mjijackson.com/2008/02/rgb-to-hsl-and-rgb-to-hsv-color-model-conversion-algorithms-in-javascript>

    // `rgbToRgb`
    // Handle bounds / percentage checking to conform to CSS color spec
    // <http://www.w3.org/TR/css3-color/>
    // *Assumes:* r, g, b in [0, 255] or [0, 1]
    // *Returns:* { r, g, b } in [0, 255]
    function rgbToRgb(r, g, b) {
        return {
            r: bound01(r, 255) * 255,
            g: bound01(g, 255) * 255,
            b: bound01(b, 255) * 255
        };
    }

    // `rgbToHsl`
    // Converts an RGB color value to HSL.
    // *Assumes:* r, g, and b are contained in [0, 255] or [0, 1]
    // *Returns:* { h, s, l } in [0,1]
    function rgbToHsl(r, g, b) {

        r = bound01(r, 255);
        g = bound01(g, 255);
        b = bound01(b, 255);

        var max = mathMax(r, g, b),
            min = mathMin(r, g, b);
        var h, s, l = (max + min) / 2;

        if (max == min) {
            h = s = 0; // achromatic
        } else {
            var d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r:
                    h = (g - b) / d + (g < b ? 6 : 0);
                    break;
                case g:
                    h = (b - r) / d + 2;
                    break;
                case b:
                    h = (r - g) / d + 4;
                    break;
            }

            h /= 6;
        }

        return {
            h: h,
            s: s,
            l: l
        };
    }

    // `hslToRgb`
    // Converts an HSL color value to RGB.
    // *Assumes:* h is contained in [0, 1] or [0, 360] and s and l are contained [0, 1] or [0, 100]
    // *Returns:* { r, g, b } in the set [0, 255]
    function hslToRgb(h, s, l) {
        var r, g, b;

        h = bound01(h, 360);
        s = bound01(s, 100);
        l = bound01(l, 100);

        function hue2rgb(p, q, t) {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        }

        if (s === 0) {
            r = g = b = l; // achromatic
        } else {
            var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            var p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }

        return {
            r: r * 255,
            g: g * 255,
            b: b * 255
        };
    }

    // `rgbToHsv`
    // Converts an RGB color value to HSV
    // *Assumes:* r, g, and b are contained in the set [0, 255] or [0, 1]
    // *Returns:* { h, s, v } in [0,1]
    function rgbToHsv(r, g, b) {

        r = bound01(r, 255);
        g = bound01(g, 255);
        b = bound01(b, 255);

        var max = mathMax(r, g, b),
            min = mathMin(r, g, b);
        var h, s, v = max;

        var d = max - min;
        s = max === 0 ? 0 : d / max;

        if (max == min) {
            h = 0; // achromatic
        } else {
            switch (max) {
                case r:
                    h = (g - b) / d + (g < b ? 6 : 0);
                    break;
                case g:
                    h = (b - r) / d + 2;
                    break;
                case b:
                    h = (r - g) / d + 4;
                    break;
            }
            h /= 6;
        }
        return {
            h: h,
            s: s,
            v: v
        };
    }

    // `hsvToRgb`
    // Converts an HSV color value to RGB.
    // *Assumes:* h is contained in [0, 1] or [0, 360] and s and v are contained in [0, 1] or [0, 100]
    // *Returns:* { r, g, b } in the set [0, 255]
    function hsvToRgb(h, s, v) {

        h = bound01(h, 360) * 6;
        s = bound01(s, 100);
        v = bound01(v, 100);

        var i = math.floor(h),
            f = h - i,
            p = v * (1 - s),
            q = v * (1 - f * s),
            t = v * (1 - (1 - f) * s),
            mod = i % 6,
            r = [v, q, p, p, t, v][mod],
            g = [t, v, v, q, p, p][mod],
            b = [p, p, t, v, v, q][mod];

        return {
            r: r * 255,
            g: g * 255,
            b: b * 255
        };
    }

    // `rgbToHex`
    // Converts an RGB color to hex
    // Assumes r, g, and b are contained in the set [0, 255]
    // Returns a 3 or 6 character hex
    function rgbToHex(r, g, b, allow3Char) {

        var hex = [
            pad2(mathRound(r).toString(16)),
            pad2(mathRound(g).toString(16)),
            pad2(mathRound(b).toString(16))
        ];

        // Return a 3 character hex if possible
        if (allow3Char && hex[0].charAt(0) == hex[0].charAt(1) && hex[1].charAt(0) == hex[1].charAt(1) && hex[2].charAt(0) == hex[2].charAt(1)) {
            return hex[0].charAt(0) + hex[1].charAt(0) + hex[2].charAt(0);
        }

        return hex.join("");
    }

    // `equals`
    // Can be called with any tinycolor input
    tinycolor.equals = function(color1, color2) {
        if (!color1 || !color2) {
            return false;
        }
        return tinycolor(color1).toRgbString() == tinycolor(color2).toRgbString();
    };
    tinycolor.random = function() {
        return tinycolor.fromRatio({
            r: mathRandom(),
            g: mathRandom(),
            b: mathRandom()
        });
    };


    // Modification Functions
    // ----------------------
    // Thanks to less.js for some of the basics here
    // <https://github.com/cloudhead/less.js/blob/master/lib/less/functions.js>

    tinycolor.desaturate = function(color, amount) {
        amount = (amount === 0) ? 0 : (amount || 10);
        var hsl = tinycolor(color).toHsl();
        hsl.s -= amount / 100;
        hsl.s = clamp01(hsl.s);
        return tinycolor(hsl);
    };
    tinycolor.saturate = function(color, amount) {
        amount = (amount === 0) ? 0 : (amount || 10);
        var hsl = tinycolor(color).toHsl();
        hsl.s += amount / 100;
        hsl.s = clamp01(hsl.s);
        return tinycolor(hsl);
    };
    tinycolor.greyscale = function(color) {
        return tinycolor.desaturate(color, 100);
    };
    tinycolor.lighten = function(color, amount) {
        amount = (amount === 0) ? 0 : (amount || 10);
        var hsl = tinycolor(color).toHsl();
        hsl.l += amount / 100;
        hsl.l = clamp01(hsl.l);
        return tinycolor(hsl);
    };
    tinycolor.darken = function(color, amount) {
        amount = (amount === 0) ? 0 : (amount || 10);
        var hsl = tinycolor(color).toHsl();
        hsl.l -= amount / 100;
        hsl.l = clamp01(hsl.l);
        return tinycolor(hsl);
    };
    tinycolor.complement = function(color) {
        var hsl = tinycolor(color).toHsl();
        hsl.h = (hsl.h + 180) % 360;
        return tinycolor(hsl);
    };


    // Combination Functions
    // ---------------------
    // Thanks to jQuery xColor for some of the ideas behind these
    // <https://github.com/infusion/jQuery-xcolor/blob/master/jquery.xcolor.js>

    tinycolor.triad = function(color) {
        var hsl = tinycolor(color).toHsl();
        var h = hsl.h;
        return [
            tinycolor(color),
            tinycolor({
                h: (h + 120) % 360,
                s: hsl.s,
                l: hsl.l
            }),
            tinycolor({
                h: (h + 240) % 360,
                s: hsl.s,
                l: hsl.l
            })
        ];
    };
    tinycolor.tetrad = function(color) {
        var hsl = tinycolor(color).toHsl();
        var h = hsl.h;
        return [
            tinycolor(color),
            tinycolor({
                h: (h + 90) % 360,
                s: hsl.s,
                l: hsl.l
            }),
            tinycolor({
                h: (h + 180) % 360,
                s: hsl.s,
                l: hsl.l
            }),
            tinycolor({
                h: (h + 270) % 360,
                s: hsl.s,
                l: hsl.l
            })
        ];
    };
    tinycolor.splitcomplement = function(color) {
        var hsl = tinycolor(color).toHsl();
        var h = hsl.h;
        return [
            tinycolor(color),
            tinycolor({
                h: (h + 72) % 360,
                s: hsl.s,
                l: hsl.l
            }),
            tinycolor({
                h: (h + 216) % 360,
                s: hsl.s,
                l: hsl.l
            })
        ];
    };
    tinycolor.analogous = function(color, results, slices) {
        results = results || 6;
        slices = slices || 30;

        var hsl = tinycolor(color).toHsl();
        var part = 360 / slices;
        var ret = [tinycolor(color)];

        for (hsl.h = ((hsl.h - (part * results >> 1)) + 720) % 360; --results;) {
            hsl.h = (hsl.h + part) % 360;
            ret.push(tinycolor(hsl));
        }
        return ret;
    };
    tinycolor.monochromatic = function(color, results) {
        results = results || 6;
        var hsv = tinycolor(color).toHsv();
        var h = hsv.h,
            s = hsv.s,
            v = hsv.v;
        var ret = [];
        var modification = 1 / results;

        while (results--) {
            ret.push(tinycolor({
                h: h,
                s: s,
                v: v
            }));
            v = (v + modification) % 1;
        }

        return ret;
    };


    // Readability Functions
    // ---------------------
    // <http://www.w3.org/TR/AERT#color-contrast>

    // `readability`
    // Analyze the 2 colors and returns an object with the following properties:
    //    `brightness`: difference in brightness between the two colors
    //    `color`: difference in color/hue between the two colors
    tinycolor.readability = function(color1, color2) {
        var a = tinycolor(color1).toRgb();
        var b = tinycolor(color2).toRgb();
        var brightnessA = (a.r * 299 + a.g * 587 + a.b * 114) / 1000;
        var brightnessB = (b.r * 299 + b.g * 587 + b.b * 114) / 1000;
        var colorDiff = (
            Math.max(a.r, b.r) - Math.min(a.r, b.r) +
            Math.max(a.g, b.g) - Math.min(a.g, b.g) +
            Math.max(a.b, b.b) - Math.min(a.b, b.b)
        );

        return {
            brightness: Math.abs(brightnessA - brightnessB),
            color: colorDiff
        };
    };

    // `readable`
    // http://www.w3.org/TR/AERT#color-contrast
    // Ensure that foreground and background color combinations provide sufficient contrast.
    // *Example*
    //    tinycolor.readable("#000", "#111") => false
    tinycolor.readable = function(color1, color2) {
        var readability = tinycolor.readability(color1, color2);
        return readability.brightness > 125 && readability.color > 500;
    };

    // `mostReadable`
    // Given a base color and a list of possible foreground or background
    // colors for that base, returns the most readable color.
    // *Example*
    //    tinycolor.mostReadable("#123", ["#fff", "#000"]) => "#000"
    tinycolor.mostReadable = function(baseColor, colorList) {
        var bestColor = null;
        var bestScore = 0;
        var bestIsReadable = false;
        for (var i = 0; i < colorList.length; i++) {

            // We normalize both around the "acceptable" breaking point,
            // but rank brightness constrast higher than hue.

            var readability = tinycolor.readability(baseColor, colorList[i]);
            var readable = readability.brightness > 125 && readability.color > 500;
            var score = 3 * (readability.brightness / 125) + (readability.color / 500);

            if ((readable && !bestIsReadable) ||
                (readable && bestIsReadable && score > bestScore) ||
                ((!readable) && (!bestIsReadable) && score > bestScore)) {
                bestIsReadable = readable;
                bestScore = score;
                bestColor = tinycolor(colorList[i]);
            }
        }
        return bestColor;
    };


    // Big List of Colors
    // ------------------
    // <http://www.w3.org/TR/css3-color/#svg-color>
    var names = tinycolor.names = {
        aliceblue: "f0f8ff",
        antiquewhite: "faebd7",
        aqua: "0ff",
        aquamarine: "7fffd4",
        azure: "f0ffff",
        beige: "f5f5dc",
        bisque: "ffe4c4",
        black: "000",
        blanchedalmond: "ffebcd",
        blue: "00f",
        blueviolet: "8a2be2",
        brown: "a52a2a",
        burlywood: "deb887",
        burntsienna: "ea7e5d",
        cadetblue: "5f9ea0",
        chartreuse: "7fff00",
        chocolate: "d2691e",
        coral: "ff7f50",
        cornflowerblue: "6495ed",
        cornsilk: "fff8dc",
        crimson: "dc143c",
        cyan: "0ff",
        darkblue: "00008b",
        darkcyan: "008b8b",
        darkgoldenrod: "b8860b",
        darkgray: "a9a9a9",
        darkgreen: "006400",
        darkgrey: "a9a9a9",
        darkkhaki: "bdb76b",
        darkmagenta: "8b008b",
        darkolivegreen: "556b2f",
        darkorange: "ff8c00",
        darkorchid: "9932cc",
        darkred: "8b0000",
        darksalmon: "e9967a",
        darkseagreen: "8fbc8f",
        darkslateblue: "483d8b",
        darkslategray: "2f4f4f",
        darkslategrey: "2f4f4f",
        darkturquoise: "00ced1",
        darkviolet: "9400d3",
        deeppink: "ff1493",
        deepskyblue: "00bfff",
        dimgray: "696969",
        dimgrey: "696969",
        dodgerblue: "1e90ff",
        firebrick: "b22222",
        floralwhite: "fffaf0",
        forestgreen: "228b22",
        fuchsia: "f0f",
        gainsboro: "dcdcdc",
        ghostwhite: "f8f8ff",
        gold: "ffd700",
        goldenrod: "daa520",
        gray: "808080",
        green: "008000",
        greenyellow: "adff2f",
        grey: "808080",
        honeydew: "f0fff0",
        hotpink: "ff69b4",
        indianred: "cd5c5c",
        indigo: "4b0082",
        ivory: "fffff0",
        khaki: "f0e68c",
        lavender: "e6e6fa",
        lavenderblush: "fff0f5",
        lawngreen: "7cfc00",
        lemonchiffon: "fffacd",
        lightblue: "add8e6",
        lightcoral: "f08080",
        lightcyan: "e0ffff",
        lightgoldenrodyellow: "fafad2",
        lightgray: "d3d3d3",
        lightgreen: "90ee90",
        lightgrey: "d3d3d3",
        lightpink: "ffb6c1",
        lightsalmon: "ffa07a",
        lightseagreen: "20b2aa",
        lightskyblue: "87cefa",
        lightslategray: "789",
        lightslategrey: "789",
        lightsteelblue: "b0c4de",
        lightyellow: "ffffe0",
        lime: "0f0",
        limegreen: "32cd32",
        linen: "faf0e6",
        magenta: "f0f",
        maroon: "800000",
        mediumaquamarine: "66cdaa",
        mediumblue: "0000cd",
        mediumorchid: "ba55d3",
        mediumpurple: "9370db",
        mediumseagreen: "3cb371",
        mediumslateblue: "7b68ee",
        mediumspringgreen: "00fa9a",
        mediumturquoise: "48d1cc",
        mediumvioletred: "c71585",
        midnightblue: "191970",
        mintcream: "f5fffa",
        mistyrose: "ffe4e1",
        moccasin: "ffe4b5",
        navajowhite: "ffdead",
        navy: "000080",
        oldlace: "fdf5e6",
        olive: "808000",
        olivedrab: "6b8e23",
        orange: "ffa500",
        orangered: "ff4500",
        orchid: "da70d6",
        palegoldenrod: "eee8aa",
        palegreen: "98fb98",
        paleturquoise: "afeeee",
        palevioletred: "db7093",
        papayawhip: "ffefd5",
        peachpuff: "ffdab9",
        peru: "cd853f",
        pink: "ffc0cb",
        plum: "dda0dd",
        powderblue: "b0e0e6",
        purple: "800080",
        red: "f00",
        rosybrown: "bc8f8f",
        royalblue: "4169e1",
        saddlebrown: "8b4513",
        salmon: "fa8072",
        sandybrown: "f4a460",
        seagreen: "2e8b57",
        seashell: "fff5ee",
        sienna: "a0522d",
        silver: "c0c0c0",
        skyblue: "87ceeb",
        slateblue: "6a5acd",
        slategray: "708090",
        slategrey: "708090",
        snow: "fffafa",
        springgreen: "00ff7f",
        steelblue: "4682b4",
        tan: "d2b48c",
        teal: "008080",
        thistle: "d8bfd8",
        tomato: "ff6347",
        turquoise: "40e0d0",
        violet: "ee82ee",
        wheat: "f5deb3",
        white: "fff",
        whitesmoke: "f5f5f5",
        yellow: "ff0",
        yellowgreen: "9acd32"
    };

    // Make it easy to access colors via `hexNames[hex]`
    var hexNames = tinycolor.hexNames = flip(names);


    // Utilities
    // ---------

    // `{ 'name1': 'val1' }` becomes `{ 'val1': 'name1' }`
    function flip(o) {
        var flipped = {};
        for (var i in o) {
            if (o.hasOwnProperty(i)) {
                flipped[o[i]] = i;
            }
        }
        return flipped;
    }

    // Take input from [0, n] and return it as [0, 1]
    function bound01(n, max) {
        if (isOnePointZero(n)) {
            n = "100%";
        }

        var processPercent = isPercentage(n);
        n = mathMin(max, mathMax(0, parseFloat(n)));

        // Automatically convert percentage into number
        if (processPercent) {
            n = parseInt(n * max, 10) / 100;
        }

        // Handle floating point rounding errors
        if ((math.abs(n - max) < 0.000001)) {
            return 1;
        }

        // Convert into [0, 1] range if it isn't already
        return (n % max) / parseFloat(max);
    }

    // Force a number between 0 and 1
    function clamp01(val) {
        return mathMin(1, mathMax(0, val));
    }

    // Parse an integer into hex
    function parseHex(val) {
        return parseInt(val, 16);
    }

    // Need to handle 1.0 as 100%, since once it is a number, there is no difference between it and 1
    // <http://stackoverflow.com/questions/7422072/javascript-how-to-detect-number-as-a-decimal-including-1-0>
    function isOnePointZero(n) {
        return typeof n == "string" && n.indexOf('.') != -1 && parseFloat(n) === 1;
    }

    // Check to see if string passed in is a percentage
    function isPercentage(n) {
        return typeof n === "string" && n.indexOf('%') != -1;
    }

    // Force a hex value to have 2 characters
    function pad2(c) {
        return c.length == 1 ? '0' + c : '' + c;
    }

    // Replace a decimal with it's percentage value
    function convertToPercentage(n) {
        if (n <= 1) {
            n = (n * 100) + "%";
        }

        return n;
    }

    var matchers = (function() {

        // <http://www.w3.org/TR/css3-values/#integers>
        var CSS_INTEGER = "[-\\+]?\\d+%?";

        // <http://www.w3.org/TR/css3-values/#number-value>
        var CSS_NUMBER = "[-\\+]?\\d*\\.\\d+%?";

        // Allow positive/negative integer/number.  Don't capture the either/or, just the entire outcome.
        var CSS_UNIT = "(?:" + CSS_NUMBER + ")|(?:" + CSS_INTEGER + ")";

        // Actual matching.
        // Parentheses and commas are optional, but not required.
        // Whitespace can take the place of commas or opening paren
        var PERMISSIVE_MATCH3 = "[\\s|\\(]+(" + CSS_UNIT + ")[,|\\s]+(" + CSS_UNIT + ")[,|\\s]+(" + CSS_UNIT + ")\\s*\\)?";
        var PERMISSIVE_MATCH4 = "[\\s|\\(]+(" + CSS_UNIT + ")[,|\\s]+(" + CSS_UNIT + ")[,|\\s]+(" + CSS_UNIT + ")[,|\\s]+(" + CSS_UNIT + ")\\s*\\)?";

        return {
            rgb: new RegExp("rgb" + PERMISSIVE_MATCH3),
            rgba: new RegExp("rgba" + PERMISSIVE_MATCH4),
            hsl: new RegExp("hsl" + PERMISSIVE_MATCH3),
            hsla: new RegExp("hsla" + PERMISSIVE_MATCH4),
            hsv: new RegExp("hsv" + PERMISSIVE_MATCH3),
            hex3: /^([0-9a-fA-F]{1})([0-9a-fA-F]{1})([0-9a-fA-F]{1})$/,
            hex6: /^([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/
        };
    })();

    // `stringInputToObject`
    // Permissive string parsing.  Take in a number of formats, and output an object
    // based on detected format.  Returns `{ r, g, b }` or `{ h, s, l }` or `{ h, s, v}`
    function stringInputToObject(color) {

        color = color.replace(trimLeft, '').replace(trimRight, '').toLowerCase();
        var named = false;
        if (names[color]) {
            color = names[color];
            named = true;
        } else if (color == 'transparent') {
            return {
                r: 0,
                g: 0,
                b: 0,
                a: 0,
                format: "name"
            };
        }

        // Try to match string input using regular expressions.
        // Keep most of the number bounding out of this function - don't worry about [0,1] or [0,100] or [0,360]
        // Just return an object and let the conversion functions handle that.
        // This way the result will be the same whether the tinycolor is initialized with string or object.
        var match;
        if ((match = matchers.rgb.exec(color))) {
            return {
                r: match[1],
                g: match[2],
                b: match[3]
            };
        }
        if ((match = matchers.rgba.exec(color))) {
            return {
                r: match[1],
                g: match[2],
                b: match[3],
                a: match[4]
            };
        }
        if ((match = matchers.hsl.exec(color))) {
            return {
                h: match[1],
                s: match[2],
                l: match[3]
            };
        }
        if ((match = matchers.hsla.exec(color))) {
            return {
                h: match[1],
                s: match[2],
                l: match[3],
                a: match[4]
            };
        }
        if ((match = matchers.hsv.exec(color))) {
            return {
                h: match[1],
                s: match[2],
                v: match[3]
            };
        }
        if ((match = matchers.hex6.exec(color))) {
            return {
                r: parseHex(match[1]),
                g: parseHex(match[2]),
                b: parseHex(match[3]),
                format: named ? "name" : "hex"
            };
        }
        if ((match = matchers.hex3.exec(color))) {
            return {
                r: parseHex(match[1] + '' + match[1]),
                g: parseHex(match[2] + '' + match[2]),
                b: parseHex(match[3] + '' + match[3]),
                format: named ? "name" : "hex"
            };
        }

        return false;
    }

    // Node: Export function
    if (typeof module !== "undefined" && module.exports) {
        module.exports = tinycolor;
    }
    // AMD/requirejs: Define the module
    else if (typeof define !== "undefined") {
        define(function() {
            return tinycolor;
        });
    }
    // Browser: Expose to window
    else {
        root.tinycolor = tinycolor;
    }

})(this);

/**
 * @license
 * File: CanvasInput.js
 *  CanvasInput v1.0.10
 *  http://goldfirestudios.com/blog/108/CanvasInput-HTML5-Canvas-Text-Input
 *
 *  (c) 2013, James Simpson of GoldFire Studios
 *  goldfirestudios.com
 *
 *  (c) 2013, Axios, Inc.
 *  Modifications made by Axios, Inc.
 *  axiosengineering.com
 *
 *  MIT License
 */

(function() {
    // create a buffer that stores all inputs so that tabbing
    // between them is made possible.
    var inputs = [];

    // initialize the Canvas Input
    var CanvasInput = window.CanvasInput = function(o) {
        var self = this;

        o = o ? o : {};

        // setup the defaults
        self._canvas = o.canvas || null;
        self._ctx = self._canvas ? self._canvas.getContext('2d') : null;
        self._x = o.x || 0;
        self._y = o.y || 0;
        self._extraX = o.extraX || 0;
        self._extraY = o.extraY || 0;
        self._fontSize = o.fontSize || 14;
        self._fontFamily = o.fontFamily || 'Arial';
        self._fontColor = o.fontColor || '#000';
        self._placeHolderColor = o.placeHolderColor || '#bfbebd';
        self._fontWeight = o.fontWeight || 'normal';
        self._fontStyle = o.fontStyle || 'normal';
        self._readonly = o.readonly || false;
        self._maxlength = o.maxlength || null;
        self._width = o.width || 150;
        self._height = o.height || self._fontSize;
        self._padding = o.padding >= 0 ? o.padding : 5;
        self._borderWidth = o.borderWidth >= 0 ? o.borderWidth : 1;
        self._borderColor = o.borderColor || '#959595';
        self._borderRadius = o.borderRadius >= 0 ? o.borderRadius : 3;
        self._backgroundImage = o.backgroundImage || '';
        self._boxShadow = o.boxShadow || '1px 1px 0px rgba(255, 255, 255, 1)';
        self._innerShadow = o.innerShadow || '0px 0px 4px rgba(0, 0, 0, 0.4)';
        self._selectionColor = o.selectionColor || 'rgba(179, 212, 253, 0.8)';
        self._placeHolder = o.placeHolder || '';
        self._value = o.value || self._placeHolder;
        self._onsubmit = o.onsubmit || function() {};
        self._onkeydown = o.onkeydown || function() {};
        self._onkeyup = o.onkeyup || function() {};
        self._onfocus = o.onfocus || function() {};
        self._onblur = o.onblur || function() {};
        self._cursor = false;
        self._cursorPos = 0;
        self._hasFocus = false;
        self._selection = [0, 0];
        self._wasOver = false;
        self._renderOnReturn = (o.renderOnReturn !== undefined ? o.renderOnReturn : true);
        self._disableBlur = o.disableBlur || false;
        self._tabToClear = o.tabToClear || false;

        // parse box shadow
        self.boxShadow(self._boxShadow, true);

        // calculate the full width and height with padding, borders and shadows
        self._calcWH();

        // setup the off-DOM canvas
        self._renderCanvas = document.createElement('canvas');
        self._renderCanvas.setAttribute('width', self.outerW);
        self._renderCanvas.setAttribute('height', self.outerH);
        self._renderCtx = self._renderCanvas.getContext('2d');

        // setup another off-DOM canvas for inner-shadows
        self._shadowCanvas = document.createElement('canvas');
        self._shadowCanvas.setAttribute('width', self._width + self._padding * 2);
        self._shadowCanvas.setAttribute('height', self._height + self._padding * 2);
        self._shadowCtx = self._shadowCanvas.getContext('2d');

        // setup the background color
        if (typeof o.backgroundGradient !== 'undefined') {
            self._backgroundColor = self._renderCtx.createLinearGradient(
                0,
                0,
                0,
                self.outerH
            );
            self._backgroundColor.addColorStop(0, o.backgroundGradient[0]);
            self._backgroundColor.addColorStop(1, o.backgroundGradient[1]);
        } else {
            self._backgroundColor = o.backgroundColor || '#fff';
        }

        // setup main canvas events
        if (self._canvas) {
            self.mousemoveCanvasListener = function(e) {
                e = e || window.event;
                self.mousemove(e, self);
            };
            self._canvas.addEventListener('mousemove', self.mousemoveCanvasListener, false);

            self.mousedownCanvasListener = function(e) {
                e = e || window.event;
                self.mousedown(e, self);
            };
            self._canvas.addEventListener('mousedown', self.mousedownCanvasListener, false);

            self.mouseupCanvasListener = function(e) {
                e = e || window.event;
                self.mouseup(e, self);
            };
            self._canvas.addEventListener('mouseup', self.mouseupCanvasListener, false);
        }

        // setup a global mouseup to blur the input outside of the canvas
        self.mouseupWindowListener = function(e) {
            e = e || window.event;
            if (self._hasFocus && !self._mouseDown) {
                self.blur();
            }
        };
        window.addEventListener('mouseup', self.mouseupWindowListener, true);

        // setup the keydown listener
        self.keydownWindowListener = function(e) {
            e = e || window.event;
            if (self._hasFocus) {
                self.keydown(e, self);
            }
        };
        window.addEventListener('keydown', self.keydownWindowListener, false);

        // setup the keyup listener
        self.keyupWindowListener = function(e) {
            e = e || window.event;
            if (self._hasFocus) {
                self._onkeyup(e, self);
            }
        };
        window.addEventListener('keyup', self.keyupWindowListener, false);

        // setup the 'paste' listener
        self.pasteWindowListener = function(e) {
            e = e || window.event;
            if (self._hasFocus) {
                var text = e.clipboardData.getData('text/plain'),
                    startText = self._value.substr(0, self._cursorPos),
                    endText = self._value.substr(self._cursorPos);
                self._value = startText + text + endText;
                self._cursorPos += text.length;

                self.render();
            }
        };
        window.addEventListener('paste', self.pasteWindowListener, false);

        // add this to the buffer
        inputs.push(self);
        self._inputsIndex = inputs.length - 1;

        // draw the text box
        self.render();
    };

    // setup the prototype
    CanvasInput.prototype = {
        /**
         * Get/set the main canvas.
         * @param  {Object} data Canvas reference.
         * @return {Mixed}      CanvasInput or current canvas.
         */
        canvas: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._canvas = data;
                self._ctx = self._canvas.getContext('2d');

                return self.render();
            } else {
                return self._canvas;
            }
        },

        /**
         * Get/set the x-position.
         * @param  {Number} data The pixel position along the x-coordinate.
         * @return {Mixed}      CanvasInput or current x-value.
         */
        x: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._x = data;

                return self.render();
            } else {
                return self._x;
            }
        },

        /**
         * Get/set the y-position.
         * @param  {Number} data The pixel position along the y-coordinate.
         * @return {Mixed}      CanvasInput or current y-value.
         */
        y: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._y = data;

                return self.render();
            } else {
                return self._y;
            }
        },

        /**
         * Get/set the extra x-position (generally used when no canvas is specified).
         * @param  {Number} data The pixel position along the x-coordinate.
         * @return {Mixed}      CanvasInput or current x-value.
         */
        extraX: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._extraX = data;

                return self.render();
            } else {
                return self._extraX;
            }
        },

        /**
         * Get/set the extra y-position (generally used when no canvas is specified).
         * @param  {Number} data The pixel position along the y-coordinate.
         * @return {Mixed}      CanvasInput or current y-value.
         */
        extraY: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._extraY = data;

                return self.render();
            } else {
                return self._extraY;
            }
        },

        /**
         * Get/set the font size.
         * @param  {Number} data Font size.
         * @return {Mixed}      CanvasInput or current font size.
         */
        fontSize: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._fontSize = data;

                return self.render();
            } else {
                return self._fontSize;
            }
        },

        /**
         * Get/set the font family.
         * @param  {String} data Font family.
         * @return {Mixed}      CanvasInput or current font family.
         */
        fontFamily: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._fontFamily = data;

                return self.render();
            } else {
                return self._fontFamily;
            }
        },

        /**
         * Get/set the font color.
         * @param  {String} data Font color.
         * @return {Mixed}      CanvasInput or current font color.
         */
        fontColor: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._fontColor = data;

                return self.render();
            } else {
                return self._fontColor;
            }
        },

        /**
         * Get/set the place holder font color.
         * @param  {String} data Font color.
         * @return {Mixed}      CanvasInput or current place holder font color.
         */
        placeHolderColor: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._placeHolderColor = data;

                return self.render();
            } else {
                return self._placeHolderColor;
            }
        },

        /**
         * Get/set the font weight.
         * @param  {String} data Font weight.
         * @return {Mixed}      CanvasInput or current font weight.
         */
        fontWeight: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._fontWeight = data;

                return self.render();
            } else {
                return self._fontWeight;
            }
        },

        /**
         * Get/set the font style.
         * @param  {String} data Font style.
         * @return {Mixed}      CanvasInput or current font style.
         */
        fontStyle: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._fontStyle = data;

                return self.render();
            } else {
                return self._fontStyle;
            }
        },

        /**
         * Get/set the width of the text box.
         * @param  {Number} data Width in pixels.
         * @return {Mixed}      CanvasInput or current width.
         */
        width: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._width = data;
                self._calcWH();
                self._updateCanvasWH();

                return self.render();
            } else {
                return self._width;
            }
        },

        /**
         * Get/set the height of the text box.
         * @param  {Number} data Height in pixels.
         * @return {Mixed}      CanvasInput or current height.
         */
        height: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._height = data;
                self._calcWH();
                self._updateCanvasWH();

                return self.render();
            } else {
                return self._height;
            }
        },

        /**
         * Get/set the padding of the text box.
         * @param  {Number} data Padding in pixels.
         * @return {Mixed}      CanvasInput or current padding.
         */
        padding: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._padding = data;
                self._calcWH();
                self._updateCanvasWH();

                return self.render();
            } else {
                return self._padding;
            }
        },

        /**
         * Get/set the border width.
         * @param  {Number} data Border width.
         * @return {Mixed}      CanvasInput or current border width.
         */
        borderWidth: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._borderWidth = data;
                self._calcWH();
                self._updateCanvasWH();

                return self.render();
            } else {
                return self._borderWidth;
            }
        },

        /**
         * Get/set the border color.
         * @param  {String} data Border color.
         * @return {Mixed}      CanvasInput or current border color.
         */
        borderColor: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._borderColor = data;

                return self.render();
            } else {
                return self._borderColor;
            }
        },

        /**
         * Get/set the border radius.
         * @param  {Number} data Border radius.
         * @return {Mixed}      CanvasInput or current border radius.
         */
        borderRadius: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._borderRadius = data;

                return self.render();
            } else {
                return self._borderRadius;
            }
        },

        /**
         * Get/set the background color.
         * @param  {Number} data Background color.
         * @return {Mixed}      CanvasInput or current background color.
         */
        backgroundColor: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._backgroundColor = data;

                return self.render();
            } else {
                return self._backgroundColor;
            }
        },

        /**
         * Get/set the background gradient.
         * @param  {Number} data Background gradient.
         * @return {Mixed}      CanvasInput or current background gradient.
         */
        backgroundGradient: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._backgroundColor = self._renderCtx.createLinearGradient(
                    0,
                    0,
                    0,
                    self.outerH
                );
                self._backgroundColor.addColorStop(0, data[0]);
                self._backgroundColor.addColorStop(1, data[1]);

                return self.render();
            } else {
                return self._backgroundColor;
            }
        },

        /**
         * Get/set the box shadow.
         * @param  {String} data     Box shadow in CSS format (1px 1px 1px rgba(0, 0, 0.5)).
         * @param  {Boolean} doReturn (optional) True to prevent a premature render.
         * @return {Mixed}          CanvasInput or current box shadow.
         */
        boxShadow: function(data, doReturn) {
            var self = this;

            if (typeof data !== 'undefined') {
                // parse box shadow
                var boxShadow = data.split('px ');
                self._boxShadow = {
                    x: self._boxShadow === 'none' ? 0 : parseInt(boxShadow[0], 10),
                    y: self._boxShadow === 'none' ? 0 : parseInt(boxShadow[1], 10),
                    blur: self._boxShadow === 'none' ? 0 : parseInt(boxShadow[2], 10),
                    color: self._boxShadow === 'none' ? '' : boxShadow[3]
                };

                // take into account the shadow and its direction
                if (self._boxShadow.x < 0) {
                    self.shadowL = Math.abs(self._boxShadow.x) + self._boxShadow.blur;
                    self.shadowR = self._boxShadow.blur + self._boxShadow.x;
                } else {
                    self.shadowL = Math.abs(self._boxShadow.blur - self._boxShadow.x);
                    self.shadowR = self._boxShadow.blur + self._boxShadow.x;
                }
                if (self._boxShadow.y < 0) {
                    self.shadowT = Math.abs(self._boxShadow.y) + self._boxShadow.blur;
                    self.shadowB = self._boxShadow.blur + self._boxShadow.y;
                } else {
                    self.shadowT = Math.abs(self._boxShadow.blur - self._boxShadow.y);
                    self.shadowB = self._boxShadow.blur + self._boxShadow.y;
                }

                self.shadowW = self.shadowL + self.shadowR;
                self.shadowH = self.shadowT + self.shadowB;

                self._calcWH();

                if (!doReturn) {
                    self._updateCanvasWH();

                    return self.render();
                }
            } else {
                return self._boxShadow;
            }
        },

        /**
         * Get/set the inner shadow.
         * @param  {String} data In the format of a CSS box shadow (1px 1px 1px rgba(0, 0, 0.5)).
         * @return {Mixed}          CanvasInput or current inner shadow.
         */
        innerShadow: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._innerShadow = data;

                return self.render();
            } else {
                return self._innerShadow;
            }
        },

        /**
         * Get/set the text selection color.
         * @param  {String} data Color.
         * @return {Mixed}      CanvasInput or current selection color.
         */
        selectionColor: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._selectionColor = data;

                return self.render();
            } else {
                return self._selectionColor;
            }
        },

        /**
         * Get/set the place holder text.
         * @param  {String} data Place holder text.
         * @return {Mixed}      CanvasInput or current place holder text.
         */
        placeHolder: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._placeHolder = data;

                return self.render();
            } else {
                return self._placeHolder;
            }
        },

        /**
         * Get/set the current text box value.
         * @param  {String} data Text value.
         * @return {Mixed}      CanvasInput or current text value.
         */
        value: function(data) {
            var self = this;

            if (typeof data !== 'undefined') {
                self._value = data;

                return self.focus();
            } else {
                return self._value;
            }
        },

        /**
         * Set or fire the onsubmit event.
         * @param  {Function} fn Custom callback.
         */
        onsubmit: function(fn) {
            var self = this;

            if (typeof fn !== 'undefined') {
                self._onsubmit = fn;

                return self;
            } else {
                self._onsubmit();
            }
        },

        /**
         * Set or fire the onkeydown event.
         * @param  {Function} fn Custom callback.
         */
        onkeydown: function(fn) {
            var self = this;

            if (typeof fn !== 'undefined') {
                self._onkeydown = fn;

                return self;
            } else {
                self._onkeydown();
            }
        },

        /**
         * Set or fire the onkeyup event.
         * @param  {Function} fn Custom callback.
         */
        onkeyup: function(fn) {
            var self = this;

            if (typeof fn !== 'undefined') {
                self._onkeyup = fn;

                return self;
            } else {
                self._onkeyup();
            }
        },

        /**
         * Place focus on the CanvasInput box, placing the cursor
         * either at the end of the text or where the user clicked.
         * @param  {Number} pos (optional) The position to place the cursor.
         * @return {CanvasInput}
         */
        focus: function(pos) {
            var self = this,
                input;

            // if this is readonly, don't allow it to get focus
            if (self._readonly) {
                return;
            }

            // only fire the focus event when going from unfocussed
            if (!self._hasFocus) {
                self._onfocus(self);
            }

            // remove selection
            if (!self._selectionUpdated) {
                self._selection = [0, 0];
            } else {
                delete self._selectionUpdated;
            }

            // update the cursor position
            self._cursorPos = (typeof pos === 'number') ? pos : self._clipText().length;

            // clear the place holder
            if (self._placeHolder === self._value) {
                self._value = '';
            }

            self._hasFocus = true;
            self._cursor = true;

            // setup cursor interval
            if (self._cursorInterval) {
                clearInterval(self._cursorInterval);
            }
            self._cursorInterval = setInterval(function() {
                self._cursor = !self._cursor;
                self.render();
            }, 500);

            // check if this is Chrome for Android (there is a bug with returning incorrect character key codes)
            var nav = navigator.userAgent.toLowerCase(),
                isChromeMobile = (nav.indexOf('chrome') >= 0 && nav.indexOf('mobile') >= 0 && nav.indexOf('android') >= 0);

            // add support for mobile
            var isMobile = (typeof window.orientation !== 'undefined');
            if (isMobile && !isChromeMobile && document && document.createElement && (input = document.createElement('input'))) {
                input.type = 'text';
                input.style.opacity = 0;
                input.style.position = 'absolute';
                input.style.left = (self._x + self._extraX + (self._canvas ? self._canvas.offsetLeft : 0)) + 'px';
                input.style.top = (self._y + self._extraY + (self._canvas ? self._canvas.offsetTop : 0)) + 'px';
                input.style.width = self._width;
                input.style.height = 0;
                document.body.appendChild(input);
                input.focus();
                input.addEventListener('blur', function() {
                    self.blur(self);
                }, false);
            } else if (isMobile) {
                self.value(prompt(self._placeHolder) || '');
            }

            return self.render();
        },

        /**
         * Removes focus from the CanvasInput box.
         * @param  {Object} _this Reference to this.
         * @return {CanvasInput}
         */
        blur: function(_this) {
            var self = _this || this;

            if (!self._disableBlur) {
                self._onblur(self);

                if (self._cursorInterval) {
                    clearInterval(self._cursorInterval);
                }
                self._hasFocus = false;
                self._cursor = false;
                self._selection = [0, 0];

                // fill the place holder
                if (self._value === '') {
                    self._value = self._placeHolder;
                }
            }

            return self.render();
        },

        /**
         * Maintains continual focus on the CanvasInput by disabling blur.
         * @param {Object} _this Reference to this.
         */
        disableBlur: function(_this) {
            var self = _this || this;
            self._disableBlur = true;
        },

        /**
         * Allows the CanvasInput to blur or focus by re-enabling blur.
         * @param {Object} _this Reference to this.
         */
        enableBlur: function(_this) {
            var self = _this || this;
            self._disableBlur = false;
        },

        /**
         * Fired with the keydown event to draw the typed characters.
         * @param  {Event}       e    The keydown event.
         * @param  {CanvasInput} self
         * @return {CanvasInput}
         */
        keydown: function(e, self) {
            var keyCode = e.which,
                isShift = e.shiftKey,
                key = null,
                startText, endText;

            // make sure the correct text field is being updated
            if (!self._hasFocus) {
                return;
            }

            // fire custom user event
            self._onkeydown(e, self);

            // add support for Ctrl/Cmd+A selection
            if (keyCode === 65 && (e.ctrlKey || e.metaKey)) {
                self._selection = [0, self._value.length];
                e.preventDefault();
                return self.render();
            }

            // block keys that shouldn't be processed
            if (keyCode === 17 || e.metaKey || e.ctrlKey) {
                return self;
            }

            // prevent the default action
            e.preventDefault();

            if (keyCode === 8) { // backspace
                if (!self._clearSelection()) {
                    if (self._cursorPos > 0) {
                        startText = self._value.substr(0, self._cursorPos - 1);
                        endText = self._value.substr(self._cursorPos, self._value.length);
                        self._value = startText + endText;
                        self._cursorPos--;
                    }
                }
            } else if (keyCode === 37) { // left arrow key
                if (self._cursorPos > 0) {
                    self._cursorPos--;
                    self._cursor = true;
                    self._selection = [0, 0];
                }
            } else if (keyCode === 39) { // right arrow key
                if (self._cursorPos < self._value.length) {
                    self._cursorPos++;
                    self._cursor = true;
                    self._selection = [0, 0];
                }
            } else if (keyCode === 13) { // enter key
                self._onsubmit(e, self);
            } else if (keyCode === 9) { // tab key
                if (self._tabToClear) {
                    self._value = "";
                    self._cursorPos = 0;
                } else {
                    var next = (inputs[self._inputsIndex + 1]) ? self._inputsIndex + 1 : 0;
                    if (next !== self._inputsIndex) {
                        self.blur();
                        setTimeout(function() {
                            inputs[next].focus();
                        }, 10);
                    }
                }
            } else if (key = self._mapCodeToKey(isShift, keyCode)) {
                self._clearSelection();

                // enforce the max length
                if (self._maxlength && self._maxlength <= self._value.length) {
                    return;
                }

                startText = (self._value) ? self._value.substr(0, self._cursorPos) : '';
                endText = (self._value) ? self._value.substr(self._cursorPos) : '';
                self._value = startText + key + endText;
                self._cursorPos++;
            }

            if ((keyCode == 13 && self._renderOnReturn) || keyCode !== 13) {
                return self.render();
            } else {
                return function() {};
            }
        },

        /**
         * Fired with the click event on the canvas, and puts focus on/off
         * based on where the user clicks.
         * @param  {Event}       e    The click event.
         * @param  {CanvasInput} self
         * @return {CanvasInput}
         */
        click: function(e, self) {
            var mouse = self._mousePos(e),
                x = mouse.x,
                y = mouse.y;

            if (self._endSelection) {
                delete self._endSelection;
                delete self._selectionUpdated;
                return;
            }

            if (self._canvas && self._overInput(x, y) || !self._canvas) {
                if (self._mouseDown) {
                    self._mouseDown = false;
                    self.click(e, self);
                    return self.focus(self._clickPos(x, y));
                }
            } else {
                return self.blur();
            }
        },

        /**
         * Fired with the mousemove event to update the default cursor.
         * @param  {Event}       e    The mousemove event.
         * @param  {CanvasInput} self
         * @return {CanvasInput}
         */
        mousemove: function(e, self) {
            var mouse = self._mousePos(e),
                x = mouse.x,
                y = mouse.y,
                isOver = self._overInput(x, y);

            if (isOver && self._canvas) {
                self._canvas.style.cursor = 'text';
                self._wasOver = true;
            } else if (self._wasOver && self._canvas) {
                self._canvas.style.cursor = 'default';
                self._wasOver = false;
            }

            if (self._hasFocus && self._selectionStart >= 0) {
                var curPos = self._clickPos(x, y),
                    start = Math.min(self._selectionStart, curPos),
                    end = Math.max(self._selectionStart, curPos);

                if (!isOver) {
                    self._selectionUpdated = true;
                    self._endSelection = true;
                    delete self._selectionStart;
                    self.render();
                    return;
                }

                if (self._selection[0] !== start || self._selection[1] !== end) {
                    self._selection = [start, end];
                    self.render();
                }
            }
        },

        /**
         * Fired with the mousedown event to start a selection drag.
         * @param  {Event} e    The mousedown event.
         * @param  {CanvasInput} self
         */
        mousedown: function(e, self) {
            var mouse = self._mousePos(e),
                x = mouse.x,
                y = mouse.y,
                isOver = self._overInput(x, y);

            // setup the 'click' event
            self._mouseDown = isOver;

            // start the selection drag if inside the input
            if (self._hasFocus && isOver) {
                self._selectionStart = self._clickPos(x, y);
            }
        },

        /**
         * Fired with the mouseup event to end a selection drag.
         * @param  {Event} e    The mouseup event.
         * @param  {CanvasInput} self
         */
        mouseup: function(e, self) {
            var mouse = self._mousePos(e),
                x = mouse.x,
                y = mouse.y;

            // update selection if a drag has happened
            var isSelection = self._clickPos(x, y) !== self._selectionStart;
            if (self._hasFocus && self._selectionStart >= 0 && self._overInput(x, y) && isSelection) {
                self._selectionUpdated = true;
                delete self._selectionStart;
                self.render();
            } else {
                delete self._selectionStart;
            }

            self.click(e, self);
        },

        /**
         * Helper method to get the off-DOM canvas.
         * @return {Object} Reference to the canvas.
         */
        renderCanvas: function() {
            return this._renderCanvas;
        },

        /**
         * Helper method to remove all event listeners, stop the blinking cursor and
         * reset the cursor style.
         */
        cleanup: function() {
            this._canvas.removeEventListener("mouseup", this.mouseupCanvasListener, false);
            this._canvas.removeEventListener("mousedown", this.mousedownCanvasListener, false);
            this._canvas.removeEventListener("mousemove", this.mousemoveCanvasListener, false);
            window.removeEventListener("keydown", this.keydownWindowListener, false);
            window.removeEventListener("keyup", this.keyupWindowListener, false);
            window.removeEventListener("mouseup", this.mouseupWindowListener, true);
            window.removeEventListener("paste", this.pasteWindowListener, false);
            clearInterval(this._cursorInterval);

            this._canvas.style.cursor = 'default';
            for (var i = 0; i < inputs.length; i++) {
                if (inputs[i] === this) {
                    inputs.remove(i);
                }
            }
        },

        /**
         * Clears and redraws the CanvasInput on an off-DOM canvas,
         * and if a main canvas is provided, draws it all onto that.
         * @return {CanvasInput}
         */
        render: function() {
            var self = this,
                ctx = self._renderCtx,
                w = self.outerW,
                h = self.outerH,
                br = self._borderRadius,
                bw = self._borderWidth,
                sw = self.shadowW,
                sh = self.shadowH;

            // clear the canvas
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

            // setup the box shadow
            ctx.shadowOffsetX = self._boxShadow.x;
            ctx.shadowOffsetY = self._boxShadow.y;
            ctx.shadowBlur = self._boxShadow.blur;
            ctx.shadowColor = self._boxShadow.color;

            // draw the border
            if (self._borderWidth > 0) {
                ctx.fillStyle = self._borderColor;
                self._roundedRect(ctx, self.shadowL, self.shadowT, w - sw, h - sh, br);
                ctx.fill();

                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
                ctx.shadowBlur = 0;
            }

            // draw the text box background
            self._drawTextBox(function() {
                // make sure all shadows are reset
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
                ctx.shadowBlur = 0;

                // clip the text so that it fits within the box
                var text = self._clipText();

                // draw the selection
                var paddingBorder = self._padding + self._borderWidth + self.shadowT;
                if (self._selection[1] > 0) {
                    var selectOffset = self._textWidth(text.substring(0, self._selection[0])),
                        selectWidth = self._textWidth(text.substring(self._selection[0], self._selection[1]));

                    ctx.fillStyle = self._selectionColor;
                    ctx.fillRect(paddingBorder + selectOffset, paddingBorder, selectWidth, self._height);
                }

                // draw the cursor
                ctx.fillStyle = (self._placeHolder === self._value && self._value !== '') ? self._placeHolderColor : self._fontColor;
                if (self._cursor) {
                    var cursorOffset = self._textWidth(text.substring(0, self._cursorPos));

                    ctx.fillRect(paddingBorder + cursorOffset, paddingBorder, 1, self._height);
                }

                // draw the text
                var textX = self._padding + self._borderWidth + self.shadowL,
                    textY = Math.round(paddingBorder + self._height / 2);

                ctx.font = self._fontStyle + ' ' + self._fontWeight + ' ' + self._fontSize + 'px ' + self._fontFamily;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(text, textX, textY);

                // parse inner shadow
                var innerShadow = self._innerShadow.split('px '),
                    isOffsetX = self._innerShadow === 'none' ? 0 : parseInt(innerShadow[0], 10),
                    isOffsetY = self._innerShadow === 'none' ? 0 : parseInt(innerShadow[1], 10),
                    isBlur = self._innerShadow === 'none' ? 0 : parseInt(innerShadow[2], 10),
                    isColor = self._innerShadow === 'none' ? '' : innerShadow[3];

                // draw the inner-shadow (damn you canvas, this should be easier than this...)
                if (isBlur > 0) {
                    var shadowCtx = self._shadowCtx,
                        scw = shadowCtx.canvas.width,
                        sch = shadowCtx.canvas.height;

                    shadowCtx.clearRect(0, 0, scw, sch);
                    shadowCtx.shadowBlur = isBlur;
                    shadowCtx.shadowColor = isColor;

                    // top shadow
                    shadowCtx.shadowOffsetX = 0;
                    shadowCtx.shadowOffsetY = isOffsetY;
                    shadowCtx.fillRect(-1 * w, -100, 3 * w, 100);

                    // right shadow
                    shadowCtx.shadowOffsetX = isOffsetX;
                    shadowCtx.shadowOffsetY = 0;
                    shadowCtx.fillRect(scw, -1 * h, 100, 3 * h);

                    // bottom shadow
                    shadowCtx.shadowOffsetX = 0;
                    shadowCtx.shadowOffsetY = isOffsetY;
                    shadowCtx.fillRect(-1 * w, sch, 3 * w, 100);

                    // left shadow
                    shadowCtx.shadowOffsetX = isOffsetX;
                    shadowCtx.shadowOffsetY = 0;
                    shadowCtx.fillRect(-100, -1 * h, 100, 3 * h);

                    // create a clipping mask on the main canvas
                    self._roundedRect(ctx, bw + self.shadowL, bw + self.shadowT, w - bw * 2 - sw, h - bw * 2 - sh, br);
                    ctx.clip();

                    // draw the inner-shadow from the off-DOM canvas
                    ctx.drawImage(self._shadowCanvas, 0, 0, scw, sch, bw + self.shadowL, bw + self.shadowT, scw, sch);
                }

                // draw to the visible canvas
                if (self._ctx) {
                    self._ctx.clearRect(self._x, self._y, ctx.canvas.width, ctx.canvas.height);
                    self._ctx.drawImage(self._renderCanvas, self._x, self._y);
                }

                return self;

            });
        },

        /**
         * Draw the text box area with either an image or background color.
         * @param  {Function} fn Callback.
         */
        _drawTextBox: function(fn) {
            var self = this,
                ctx = self._renderCtx,
                w = self.outerW,
                h = self.outerH,
                br = self._borderRadius,
                bw = self._borderWidth,
                sw = self.shadowW,
                sh = self.shadowH;

            // only draw the background shape if no image is being used
            if (self._backgroundImage === '') {
                ctx.fillStyle = self._backgroundColor;
                self._roundedRect(ctx, bw + self.shadowL, bw + self.shadowT, w - bw * 2 - sw, h - bw * 2 - sh, br);
                ctx.fill();

                fn();
            } else {
                var img = new Image();
                img.src = self._backgroundImage;
                img.onload = function() {
                    ctx.drawImage(img, 0, 0, img.width, img.height, bw + self.shadowL, bw + self.shadowT, w, h);

                    fn();
                };
            }
        },

        /**
         * Deletes selected text in selection range and repositions cursor.
         * @return {Boolean} true if text removed.
         */
        _clearSelection: function() {
            var self = this;

            if (self._selection[1] > 0) {
                // clear the selected contents
                var start = self._selection[0],
                    end = self._selection[1];

                self._value = self._value.substr(0, start) + self._value.substr(end);
                self._cursorPos = start;
                self._cursorPos = (self._cursorPos < 0) ? 0 : self._cursorPos;
                self._selection = [0, 0];

                return true;
            }

            return false;
        },

        /**
         * Clip the text string to only return what fits in the visible text box.
         * @param  {String} value The text to clip.
         * @return {String} The clipped text.
         */
        _clipText: function(value) {
            var self = this;
            value = (typeof value === 'undefined') ? self._value : value;

            var textWidth = self._textWidth(value),
                fillPer = textWidth / (self._width - self._padding),
                text = fillPer > 1 ? value.substr(-1 * Math.floor(value.length / fillPer)) : value;

            return text + '';
        },

        /**
         * Gets the pixel with of passed text.
         * @param  {String} text The text to measure.
         * @return {Number}      The measured width.
         */
        _textWidth: function(text) {
            var self = this,
                ctx = self._renderCtx;

            ctx.font = self._fontStyle + ' ' + self._fontWeight + ' ' + self._fontSize + 'px ' + self._fontFamily;
            ctx.textAlign = 'left';

            return ctx.measureText(text).width;
        },

        /**
         * Recalculate the outer with and height of the text box.
         */
        _calcWH: function() {
            var self = this;

            // calculate the full width and height with padding, borders and shadows
            self.outerW = self._width + self._padding * 2 + self._borderWidth * 2 + self.shadowW;
            self.outerH = self._height + self._padding * 2 + self._borderWidth * 2 + self.shadowH;
        },

        /**
         * Update the width and height of the off-DOM canvas when attributes are changed.
         */
        _updateCanvasWH: function() {
            var self = this,
                oldW = self._renderCanvas.width,
                oldH = self._renderCanvas.height;

            // update off-DOM canvas
            self._renderCanvas.setAttribute('width', self.outerW);
            self._renderCanvas.setAttribute('height', self.outerH);
            self._shadowCanvas.setAttribute('width', self._width + self._padding * 2);
            self._shadowCanvas.setAttribute('height', self._height + self._padding * 2);

            // clear the main canvas
            if (self._ctx) {
                self._ctx.clearRect(self._x, self._y, oldW, oldH);
            }
        },

        /**
         * Creates the path for a rectangle with rounded corners.
         * Must call ctx.fill() after calling this to draw the rectangle.
         * @param  {Object} ctx Canvas context.
         * @param  {Number} x   x-coordinate to draw from.
         * @param  {Number} y   y-coordinate to draw from.
         * @param  {Number} w   Width of rectangle.
         * @param  {Number} h   Height of rectangle.
         * @param  {Number} r   Border radius.
         */
        _roundedRect: function(ctx, x, y, w, h, r) {
            if (w < 2 * r) r = w / 2;
            if (h < 2 * r) r = h / 2;

            ctx.beginPath();

            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            ctx.lineTo(x + w, y + h - r);
            ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            ctx.lineTo(x + r, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);

            ctx.closePath();
        },

        /**
         * Checks if a coordinate point is over the input box.
         * @param  {Number} x x-coordinate position.
         * @param  {Number} y y-coordinate position.
         * @return {Boolean}   True if it is over the input box.
         */
        _overInput: function(x, y) {
            var self = this,
                xLeft = x >= self._x + self._extraX,
                xRight = x <= self._x + self._extraX + self._width + self._padding * 2,
                yTop = y >= self._y + self._extraY,
                yBottom = y <= self._y + self._extraY + self._height + self._padding * 2;

            return xLeft && xRight && yTop && yBottom;
        },

        /**
         * Use the mouse's x & y coordinates to determine
         * the position clicked in the text.
         * @param  {Number} x X-coordinate.
         * @param  {Number} y Y-coordinate.
         * @return {Number}   Cursor position.
         */
        _clickPos: function(x, y) {
            var self = this,
                value = self._value;

            // don't count placeholder text in this
            if (self._value === self._placeHolder) {
                value = '';
            }

            // determine where the click was made along the string
            var text = self._clipText(value),
                totalW = 0,
                pos = text.length;

            if (x - (self._x + self._extraX) < self._textWidth(text)) {
                // loop through each character to identify the position
                for (var i = 0; i < text.length; i++) {
                    totalW += self._textWidth(text[i]);
                    if (totalW >= x - (self._x + self._extraX)) {
                        pos = i;
                        break;
                    }
                }
            }

            return pos;
        },

        /**
         * Calculate the mouse position based on the event callback and the elements on the page.
         * @param  {Event} e
         * @return {Object}   x & y values
         */
        _mousePos: function(e) {
            var elm = e.target,
                style = document.defaultView.getComputedStyle(elm, undefined),
                paddingLeft = parseInt(style['paddingLeft'], 10) || 0,
                paddingTop = parseInt(style['paddingLeft'], 10) || 0,
                borderLeft = parseInt(style['borderLeftWidth'], 10) || 0,
                borderTop = parseInt(style['borderLeftWidth'], 10) || 0,
                htmlTop = document.body.parentNode.offsetTop || 0,
                htmlLeft = document.body.parentNode.offsetLeft || 0,
                offsetX = 0,
                offsetY = 0,
                x, y;

            // calculate the total offset
            if (typeof elm.offsetParent !== 'unefined') {
                do {
                    offsetX += elm.offsetLeft;
                    offsetY += elm.offsetTop;
                } while ((elm = elm.offsetParent));
            }

            // take into account borders and padding
            offsetX += paddingLeft + borderLeft + htmlLeft;
            offsetY += paddingTop + borderTop + htmlTop;

            return {
                x: e.pageX - offsetX,
                y: e.pageY - offsetY
            };
        },

        /**
         * Translate a keycode into the correct keyboard character.
         * @param  {Boolean} isShift True if the shift key is being pressed.
         * @param  {Number}  keyCode The character code.
         * @return {String}          The translated character.
         */
        _mapCodeToKey: function(isShift, keyCode) {
            var self = this,
                blockedKeys = [8, 9, 13, 16, 17, 18, 20, 27, 91, 92],
                key = '';

            // block keys that we don't want to type
            for (var i = 0; i < blockedKeys.length; i++) {
                if (keyCode === blockedKeys[i]) {
                    return;
                }
            }

            // make sure we are getting the correct input
            if (typeof isShift !== 'boolean' || typeof keyCode !== 'number') {
                return;
            }

            var charMap = {
                32: ' ',
                48: ')',
                49: '!',
                50: '@',
                51: '#',
                52: '$',
                53: '%',
                54: '^',
                55: '&',
                56: '*',
                57: '(',
                59: ':',
                107: '+',
                189: '_',
                186: ':',
                187: '+',
                188: '<',
                190: '>',
                191: '?',
                192: '~',
                219: '{',
                220: '|',
                221: '}',
                222: '"'
            };

            // convert the code to a character
            if (isShift) {
                key = (keyCode >= 65 && keyCode <= 90) ? String.fromCharCode(keyCode) : charMap[keyCode];
            } else {
                if (keyCode >= 65 && keyCode <= 90) {
                    key = String.fromCharCode(keyCode).toLowerCase();
                } else {
                    if (keyCode === 96) {
                        key = '0';
                    } else if (keyCode === 97) {
                        key = '1';
                    } else if (keyCode === 98) {
                        key = '2';
                    } else if (keyCode === 99) {
                        key = '3';
                    } else if (keyCode === 100) {
                        key = '4';
                    } else if (keyCode === 101) {
                        key = '5';
                    } else if (keyCode === 102) {
                        key = '6';
                    } else if (keyCode === 103) {
                        key = '7';
                    } else if (keyCode === 104) {
                        key = '8';
                    } else if (keyCode === 105) {
                        key = '9';
                    } else if (keyCode === 188) {
                        key = ',';
                    } else if (keyCode === 190) {
                        key = '.';
                    } else if (keyCode === 191) {
                        key = '/';
                    } else if (keyCode === 192) {
                        key = '`';
                    } else if (keyCode === 220) {
                        key = '\\';
                    } else if (keyCode === 187) {
                        key = '=';
                    } else if (keyCode === 189) {
                        key = '-';
                    } else if (keyCode === 222) {
                        key = '\'';
                    } else if (keyCode === 186) {
                        key = ';';
                    } else if (keyCode === 219) {
                        key = '[';
                    } else if (keyCode === 221) {
                        key = ']';
                    } else {
                        key = String.fromCharCode(keyCode);
                    }
                }
            }

            return key;
        }
    };
})();

/**
 * @license
 * File: spin.js
 * Copyright (c) 2011-2013 Felix Gnass
 * Licensed under the MIT license
 */
(function(root, factory) {

        /* CommonJS */
        if (typeof exports == 'object') module.exports = factory()

        /* AMD module */
        else if (typeof define == 'function' && define.amd) define(factory)

        /* Browser global */
        else root.Spinner = factory()
    }
    (this, function() {
        "use strict";

        var prefixes = ['webkit', 'Moz', 'ms', 'O'] /* Vendor prefixes */ ,
            animations = {} /* Animation rules keyed by their name */ , useCssAnimations /* Whether to use CSS animations or setTimeout */

            /**
             * Utility function to create elements. If no tag name is given,
             * a DIV is created. Optionally properties can be passed.
             */
            function createEl(tag, prop) {
                var el = document.createElement(tag || 'div'),
                    n

                for (n in prop) el[n] = prop[n]
                return el
            }

            /**
             * Appends children and returns the parent.
             */
            function ins(parent /* child1, child2, ...*/ ) {
                for (var i = 1, n = arguments.length; i < n; i++)
                    parent.appendChild(arguments[i])

                return parent
            }

            /**
             * Insert a new stylesheet to hold the @keyframe or VML rules.
             */
        var sheet = (function() {
            var el = createEl('style', {
                type: 'text/css'
            })
            ins(document.getElementsByTagName('head')[0], el)
            return el.sheet || el.styleSheet
        }())

        /**
         * Creates an opacity keyframe animation rule and returns its name.
         * Since most mobile Webkits have timing issues with animation-delay,
         * we create separate rules for each line/segment.
         */
            function addAnimation(alpha, trail, i, lines) {
                var name = ['opacity', trail, ~~ (alpha * 100), i, lines].join('-'),
                    start = 0.01 + i / lines * 100,
                    z = Math.max(1 - (1 - alpha) / trail * (100 - start), alpha),
                    prefix = useCssAnimations.substring(0, useCssAnimations.indexOf('Animation')).toLowerCase(),
                    pre = prefix && '-' + prefix + '-' || ''

                if (!animations[name]) {
                    sheet.insertRule(
                        '@' + pre + 'keyframes ' + name + '{' +
                        '0%{opacity:' + z + '}' +
                        start + '%{opacity:' + alpha + '}' +
                        (start + 0.01) + '%{opacity:1}' +
                        (start + trail) % 100 + '%{opacity:' + alpha + '}' +
                        '100%{opacity:' + z + '}' +
                        '}', sheet.cssRules.length)

                    animations[name] = 1
                }

                return name
            }

            /**
             * Tries various vendor prefixes and returns the first supported property.
             */
            function vendor(el, prop) {
                var s = el.style,
                    pp, i

                    prop = prop.charAt(0).toUpperCase() + prop.slice(1)
                    for (i = 0; i < prefixes.length; i++) {
                        pp = prefixes[i] + prop
                        if (s[pp] !== undefined) return pp
                    }
                if (s[prop] !== undefined) return prop
            }

            /**
             * Sets multiple style properties at once.
             */
            function css(el, prop) {
                for (var n in prop)
                    el.style[vendor(el, n) || n] = prop[n]

                return el
            }

            /**
             * Fills in default values.
             */
            function merge(obj) {
                for (var i = 1; i < arguments.length; i++) {
                    var def = arguments[i]
                    for (var n in def)
                        if (obj[n] === undefined) obj[n] = def[n]
                }
                return obj
            }

            /**
             * Returns the absolute page-offset of the given element.
             */
            function pos(el) {
                var o = {
                    x: el.offsetLeft,
                    y: el.offsetTop
                }
                while ((el = el.offsetParent))
                    o.x += el.offsetLeft, o.y += el.offsetTop

                return o
            }

            /**
             * Returns the line color from the given string or array.
             */
            function getColor(color, idx) {
                return typeof color == 'string' ? color : color[idx % color.length]
            }

            // Built-in defaults

        var defaults = {
            lines: 12, // The number of lines to draw
            length: 7, // The length of each line
            width: 5, // The line thickness
            radius: 10, // The radius of the inner circle
            rotate: 0, // Rotation offset
            corners: 1, // Roundness (0..1)
            color: '#000', // #rgb or #rrggbb
            direction: 1, // 1: clockwise, -1: counterclockwise
            speed: 1, // Rounds per second
            trail: 100, // Afterglow percentage
            opacity: 1 / 4, // Opacity of the lines
            fps: 20, // Frames per second when using setTimeout()
            zIndex: 2e9, // Use a high z-index by default
            className: 'spinner', // CSS class to assign to the element
            top: 'auto', // center vertically
            left: 'auto', // center horizontally
            position: 'relative' // element position
        }

        /** The constructor */
            function Spinner(o) {
                if (typeof this == 'undefined') return new Spinner(o)
                this.opts = merge(o || {}, Spinner.defaults, defaults)
            }

            // Global defaults that override the built-ins:
        Spinner.defaults = {}

        merge(Spinner.prototype, {

            /**
             * Adds the spinner to the given target element. If this instance is already
             * spinning, it is automatically removed from its previous target b calling
             * stop() internally.
             * @private
             */
            spin: function(target) {
                this.stop()

                var self = this,
                    o = self.opts,
                    el = self.el = css(createEl(0, {
                        className: o.className
                    }), {
                        position: o.position,
                        width: 0,
                        zIndex: o.zIndex
                    }),
                    mid = o.radius + o.length + o.width,
                    ep // element position
                    , tp // target position

                if (target) {
                    target.insertBefore(el, target.firstChild || null)
                    tp = pos(target)
                    ep = pos(el)
                    css(el, {
                        left: (o.left == 'auto' ? tp.x - ep.x + (target.offsetWidth >> 1) : parseInt(o.left, 10) + mid) + 'px',
                        top: (o.top == 'auto' ? tp.y - ep.y + (target.offsetHeight >> 1) : parseInt(o.top, 10) + mid) + 'px'
                    })
                }

                el.setAttribute('role', 'progressbar')
                self.lines(el, self.opts)

                if (!useCssAnimations) {
                    // No CSS animation support, use setTimeout() instead
                    var i = 0,
                        start = (o.lines - 1) * (1 - o.direction) / 2,
                        alpha, fps = o.fps,
                        f = fps / o.speed,
                        ostep = (1 - o.opacity) / (f * o.trail / 100),
                        astep = f / o.lines

                        ;
                    (function anim() {
                        i++;
                        for (var j = 0; j < o.lines; j++) {
                            alpha = Math.max(1 - (i + (o.lines - j) * astep) % f * ostep, o.opacity)

                            self.opacity(el, j * o.direction + start, alpha, o)
                        }
                        self.timeout = self.el && setTimeout(anim, ~~ (1000 / fps))
                    })()
                }
                return self
            },

            /**
             * Stops and removes the Spinner.
             * @private
             */
            stop: function() {
                var el = this.el
                if (el) {
                    clearTimeout(this.timeout)
                    if (el.parentNode) el.parentNode.removeChild(el)
                    this.el = undefined
                }
                return this
            },

            /**
             * Internal method that draws the individual lines. Will be overwritten
             * in VML fallback mode below.
             * @private
             */
            lines: function(el, o) {
                var i = 0,
                    start = (o.lines - 1) * (1 - o.direction) / 2,
                    seg

                    function fill(color, shadow) {
                        return css(createEl(), {
                            position: 'absolute',
                            width: (o.length + o.width) + 'px',
                            height: o.width + 'px',
                            background: color,
                            boxShadow: shadow,
                            transformOrigin: 'left',
                            transform: 'rotate(' + ~~(360 / o.lines * i + o.rotate) + 'deg) translate(' + o.radius + 'px' + ',0)',
                            borderRadius: (o.corners * o.width >> 1) + 'px'
                        })
                    }

                for (; i < o.lines; i++) {
                    seg = css(createEl(), {
                        position: 'absolute',
                        top: 1 + ~(o.width / 2) + 'px',
                        transform: o.hwaccel ? 'translate3d(0,0,0)' : '',
                        opacity: o.opacity,
                        animation: useCssAnimations && addAnimation(o.opacity, o.trail, start + i * o.direction, o.lines) + ' ' + 1 / o.speed + 's linear infinite'
                    })

                    if (o.shadow) ins(seg, css(fill('#000', '0 0 4px ' + '#000'), {
                        top: 2 + 'px'
                    }))
                    ins(el, ins(seg, fill(getColor(o.color, i), '0 0 1px rgba(0,0,0,.1)')))
                }
                return el
            },

            /**
             * Internal method that adjusts the opacity of a single line.
             * Will be overwritten in VML fallback mode below.
             * @private
             */
            opacity: function(el, i, val) {
                if (i < el.childNodes.length) el.childNodes[i].style.opacity = val
            }

        })


        function initVML() {

            /* Utility function to create a VML tag */
            function vml(tag, attr) {
                return createEl('<' + tag + ' xmlns="urn:schemas-microsoft.com:vml" class="spin-vml">', attr)
            }

            // No CSS transforms but VML support, add a CSS rule for VML elements:
            sheet.addRule('.spin-vml', 'behavior:url(#default#VML)')

            Spinner.prototype.lines = function(el, o) {
                var r = o.length + o.width,
                    s = 2 * r

                    function grp() {
                        return css(
                            vml('group', {
                                coordsize: s + ' ' + s,
                                coordorigin: -r + ' ' + -r
                            }), {
                                width: s,
                                height: s
                            }
                        )
                    }

                var margin = -(o.width + o.length) * 2 + 'px',
                    g = css(grp(), {
                        position: 'absolute',
                        top: margin,
                        left: margin
                    }),
                    i

                    function seg(i, dx, filter) {
                        ins(g,
                            ins(css(grp(), {
                                    rotation: 360 / o.lines * i + 'deg',
                                    left: ~~dx
                                }),
                                ins(css(vml('roundrect', {
                                        arcsize: o.corners
                                    }), {
                                        width: r,
                                        height: o.width,
                                        left: o.radius,
                                        top: -o.width >> 1,
                                        filter: filter
                                    }),
                                    vml('fill', {
                                        color: getColor(o.color, i),
                                        opacity: o.opacity
                                    }),
                                    vml('stroke', {
                                        opacity: 0
                                    }) // transparent stroke to fix color bleeding upon opacity change
                                )
                            )
                        )
                    }

                if (o.shadow)
                    for (i = 1; i <= o.lines; i++)
                        seg(i, -2, 'progid:DXImageTransform.Microsoft.Blur(pixelradius=2,makeshadow=1,shadowopacity=.3)')

                for (i = 1; i <= o.lines; i++) seg(i)
                return ins(el, g)
            }

            Spinner.prototype.opacity = function(el, i, val, o) {
                var c = el.firstChild
                o = o.shadow && o.lines || 0
                if (c && i + o < c.childNodes.length) {
                    c = c.childNodes[i + o];
                    c = c && c.firstChild;
                    c = c && c.firstChild
                    if (c) c.opacity = val
                }
            }
        }

        var probe = css(createEl('group'), {
            behavior: 'url(#default#VML)'
        })

        if (!vendor(probe, 'transform') && probe.adj) initVML()
        else useCssAnimations = vendor(probe, 'animation')

            return Spinner

    }));

/*! loglevel - v0.6.0 - https://github.com/pimterry/loglevel - (c) 2014 Tim Perry - licensed MIT */
	
/* Modified for SigPlot to avoid polluting the global namespace *and* to ensure compatibility with
 * QUnit
 */

/**
 * @namespace
 */
window.m = window.m || {};

;(function (m, undefined) {
    var undefinedType = "undefined";


    (function (definition) {
        m.log = definition();
    }(function () {
        var self = {};
        var noop = function() {};

        function realMethod(methodName) {
            if (typeof console === undefinedType) {
                return noop;
            } else if (console[methodName] === undefined) {
                if (console.log !== undefined) {
                    return boundToConsole(console, 'log');
                } else {
                    return noop;
                }
            } else {
                return boundToConsole(console, methodName);
            }
        }

        function boundToConsole(console, methodName) {
            var method = console[methodName];
            if (method.bind === undefined) {
                if (Function.prototype.bind === undefined) {
                    return functionBindingWrapper(method, console);
                } else {
                    try {
                        return Function.prototype.bind.call(console[methodName], console);
                    } catch (e) {
                        // In IE8 + Modernizr, the bind shim will reject the above, so we fall back to wrapping
                        return functionBindingWrapper(method, console);
                    }
                }
            } else {
                return console[methodName].bind(console);
            }
        }

        function functionBindingWrapper(f, context) {
            return function() {
                Function.prototype.apply.apply(f, [context, arguments]);
            };
        }

        var logMethods = [
            "trace",
            "debug",
            "info",
            "warn",
            "error"
        ];

        function replaceLoggingMethods(methodFactory) {
            for (var ii = 0; ii < logMethods.length; ii++) {
                self[logMethods[ii]] = methodFactory(logMethods[ii]);
            }
        }

        function cookiesAvailable() {
            return (typeof window !== undefinedType &&
                    window.document !== undefined &&
                    window.document.cookie !== undefined);
        }

        function localStorageAvailable() {
            try {
                return (typeof window !== undefinedType &&
                        window.localStorage !== undefined);
            } catch (e) {
                return false;
            }
        }

        function persistLevelIfPossible(levelNum) {
            var localStorageFail = false,
                levelName;

            for (var key in self.levels) {
                if (self.levels.hasOwnProperty(key) && self.levels[key] === levelNum) {
                    levelName = key;
                    break;
                }
            }

            if (localStorageAvailable()) {
                /*
                 * Setting localStorage can create a DOM 22 Exception if running in Private mode
                 * in Safari, so even if it is available we need to catch any errors when trying
                 * to write to it
                 */
                try {
                    window.localStorage['mloglevel'] = levelName;
                } catch (e) {
                    localStorageFail = true;
                }
            } else {
                localStorageFail = true;
            }

            if (localStorageFail && cookiesAvailable()) {
                window.document.cookie = "mloglevel=" + levelName + ";";
            }
        }

        var cookieRegex = /mloglevel=([^;]+)/;

        function loadPersistedLevel() {
            var storedLevel;

            if (localStorageAvailable()) {
                storedLevel = window.localStorage['mloglevel'];
            }

            if (storedLevel === undefined && cookiesAvailable()) {
                var cookieMatch = cookieRegex.exec(window.document.cookie) || [];
                storedLevel = cookieMatch[1];
            }
            
            if (self.levels[storedLevel] === undefined) {
                storedLevel = "WARN";
            }

            self.setLevel(self.levels[storedLevel]);
        }

        /*
         *
         * Public API
         *
         */

        self.levels = { "TRACE": 0, "DEBUG": 1, "INFO": 2, "WARN": 3,
            "ERROR": 4, "SILENT": 5};

        self.setLevel = function (level) {
            if (typeof level === "number" && level >= 0 && level <= self.levels.SILENT) {
                persistLevelIfPossible(level);

                if (level === self.levels.SILENT) {
                    replaceLoggingMethods(function () {
                        return noop;
                    });
                    return;
                } else if (typeof console === undefinedType) {
                    replaceLoggingMethods(function (methodName) {
                        return function () {
                            if (typeof console !== undefinedType) {
                                self.setLevel(level);
                                self[methodName].apply(self, arguments);
                            }
                        };
                    });
                    return "No console available for logging";
                } else {
                    replaceLoggingMethods(function (methodName) {
                        if (level <= self.levels[methodName.toUpperCase()]) {
                            return realMethod(methodName);
                        } else {
                            return noop;
                        }
                    });
                }
            } else if (typeof level === "string" && self.levels[level.toUpperCase()] !== undefined) {
                self.setLevel(self.levels[level.toUpperCase()]);
            } else {
                throw "log.setLevel() called with invalid level: " + level;
            }
        };

        self.enableAll = function() {
            self.setLevel(self.levels.TRACE);
        };

        self.disableAll = function() {
            self.setLevel(self.levels.SILENT);
        };

        loadPersistedLevel();
        return self;
    }));
})(window.m);

/**
 * @license
 * File: m.js
 * Copyright (c) 2012-2014, Michael Ihde, All rights reserved.
 * Copyright (c) 2012-2014, Axios Inc., All rights reserved.
 *
 * This file is part of SigPlot.
 *
 * SigPlot is free software; you can redistribute it and/or modify it under the terms of the GNU Lesser
 * General Public License as published by the Free Software Foundation; either version 3.0 of the License, or
 * (at your option) any later version. This library is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE. See the GNU Lesser General Public License for more details. You should have received a copy of the
 * GNU Lesser General Public License along with SigPlot.
 */

/*jslint nomen: true, browser: true, devel: true*/

//Uses Immediately-invoked Function Expressions (IIFE)s for namespaces
//See http://addyosmani.com/blog/essential-js-namespacing/ for details.

/**
 * @namespace
 */
window.m = window.m || {};

(function(m, undefined) {
    'use strict';
    /** UNITS Structure:
     *		0: ["None", "U"],
     *		1: ["Time", "sec"],
     *		2: ["Delay", "sec"],
     *		3: ["Frequency", "Hz"],
     *		4: ["Time code format", ""],
     *		5: ["Distance", "m"],
     *		6: ["Speed", "m/s"],
     *		7: ["Acceleration", "m/sec^2"],
     *		8: ["Jerk", "m/sec^3"],
     *		9: ["Doppler", "Hz"],
     *		10: ["Doppler rate", "Hz/sec"],
     *		11: ["Energy", "J"],
     *		12: ["Power", "W"],
     *		13: ["Mass", "g"],
     *		14: ["Volume", "l"],
     *		15: ["Angular power density", "W/ster"],
     *		16: ["Integrated power density", "W/rad"],
     *		17: ["Spatial power density", "W/m^2"],
     *		18: ["Integrated power density", "W/m"],
     *		19: ["Spectral power density", "W/MHz"],
     *		20: ["Amplitude", "U"],
     *		21: ["Real", "U"],
     *		22: ["Imaginary", "U"],
     *		23: ["Phase", "rad"],
     *		24: ["Phase", "deg"],
     *		25: ["Phase", "cycles"],
     *		26: ["10*Log", "U"],
     *		27: ["20*Log", "U"],
     *		28: ["Magnitude", "U"],
     *		29: ["Unknown", "U"],
     *		30: ["Unknown", "U"],
     *		31: ["General dimensionless", ""],
     *		32: ["Counts", ""],
     *		33: ["Angle", "rad"],
     *		34: ["Angle", "deg"],
     *		35: ["Relative power", "dB"],
     *		36: ["Relative power", "dBm"],
     *		37: ["Relative power", "dBW"],
     *		38: ["Solid angle", "ster"],
     *		40: ["Distance", "ft"],
     *		41: ["Distance", "nmi"],
     *		42: ["Speed", "ft/sec"],
     *		43: ["Speed", "nmi/sec"],
     *		44: ["Speed", "knots=nmi/hr"],
     *		45: ["Acceleration", "ft/sec^2"],
     *		46: ["Acceleration", "nmi/sec^2"],
     *		47: ["Acceleration", "knots/sec"],
     *		48: ["Acceleration", "G"],
     *		49: ["Jerk", "G/sec"],
     *		50: ["Rotation", "rps"],
     *		51: ["Rotation", "rpm"],
     *		52: ["Angular velocity", "rad/sec"],
     *		53: ["Angular velocity", "deg/sec"],
     *		54: ["Angular acceleration", "rad/sec^2"],
     *		55: ["Angular acceleration", "deg/sec^2"],
     *		60: ["Latitude", "deg"],
     *		61: ["Longitude", "deg"],
     *		62: ["Altitude", "ft"],
     *		63: ["Altitude", "m"]
     * @global
     */
    var UNITS = {
        0: ["None", "U"],
        1: ["Time", "sec"],
        2: ["Delay", "sec"],
        3: ["Frequency", "Hz"],
        4: ["Time code format", ""],
        5: ["Distance", "m"],
        6: ["Speed", "m/s"],
        7: ["Acceleration", "m/sec^2"],
        8: ["Jerk", "m/sec^3"],
        9: ["Doppler", "Hz"],
        10: ["Doppler rate", "Hz/sec"],
        11: ["Energy", "J"],
        12: ["Power", "W"],
        13: ["Mass", "g"],
        14: ["Volume", "l"],
        15: ["Angular power density", "W/ster"],
        16: ["Integrated power density", "W/rad"],
        17: ["Spatial power density", "W/m^2"],
        18: ["Integrated power density", "W/m"],
        19: ["Spectral power density", "W/MHz"],
        20: ["Amplitude", "U"],
        21: ["Real", "U"],
        22: ["Imaginary", "U"],
        23: ["Phase", "rad"],
        24: ["Phase", "deg"],
        25: ["Phase", "cycles"],
        26: ["10*Log", "U"],
        27: ["20*Log", "U"],
        28: ["Magnitude", "U"],
        29: ["Unknown", "U"],
        30: ["Unknown", "U"],
        31: ["General dimensionless", ""],
        32: ["Counts", ""],
        33: ["Angle", "rad"],
        34: ["Angle", "deg"],
        35: ["Relative power", "dB"],
        36: ["Relative power", "dBm"],
        37: ["Relative power", "dBW"],
        38: ["Solid angle", "ster"],
        40: ["Distance", "ft"],
        41: ["Distance", "nmi"],
        42: ["Speed", "ft/sec"],
        43: ["Speed", "nmi/sec"],
        44: ["Speed", "knots=nmi/hr"],
        45: ["Acceleration", "ft/sec^2"],
        46: ["Acceleration", "nmi/sec^2"],
        47: ["Acceleration", "knots/sec"],
        48: ["Acceleration", "G"],
        49: ["Jerk", "G/sec"],
        50: ["Rotation", "rps"],
        51: ["Rotation", "rpm"],
        52: ["Angular velocity", "rad/sec"],
        53: ["Angular velocity", "deg/sec"],
        54: ["Angular acceleration", "rad/sec^2"],
        55: ["Angular acceleration", "deg/sec^2"],
        60: ["Latitude", "deg"],
        61: ["Longitude", "deg"],
        62: ["Altitude", "ft"],
        63: ["Altitude", "m"]
    };

    /** Common structure 
     * @private
     */
    m.Mc = {
        // Colormaps are stored as 7 element tables which are then
        //	interpolated to the number of colors actually used in a graphics routine
        //	call to MX$COLORMAP.

        // There are 4 colormap tables stored in the environment: A GREYSCALE,
        // COLORRAMP, COLORWHEEL, or COLORSPECTRUM.  The specific values that
        // are listed here are from xcolordef.prm (use the XCOLORMAP widget).
        //
        // The actual values are a result of tribal knowledge and years of experience
        colormap: [
            [ // GREYSCALE
                {
                    pos: 0,
                    red: 0,
                    green: 0,
                    blue: 0
                }, {
                    pos: 60,
                    red: 50,
                    green: 50,
                    blue: 50
                }, {
                    pos: 100,
                    red: 100,
                    green: 100,
                    blue: 100
                }, {
                    pos: 100,
                    red: 0,
                    green: 0,
                    blue: 0
                }, {
                    pos: 100,
                    red: 0,
                    green: 0,
                    blue: 0
                }, {
                    pos: 100,
                    red: 0,
                    green: 0,
                    blue: 0
                }, {
                    pos: 100,
                    red: 0,
                    green: 0,
                    blue: 0
                }
            ],
            [ // COLORRAMP
                {
                    pos: 0,
                    red: 0,
                    green: 0,
                    blue: 15
                }, {
                    pos: 10,
                    red: 0,
                    green: 0,
                    blue: 50
                }, {
                    pos: 31,
                    red: 0,
                    green: 65,
                    blue: 75
                }, {
                    pos: 50,
                    red: 0,
                    green: 85,
                    blue: 0
                }, {
                    pos: 70,
                    red: 75,
                    green: 80,
                    blue: 0
                }, {
                    pos: 83,
                    red: 100,
                    green: 60,
                    blue: 0
                }, {
                    pos: 100,
                    red: 100,
                    green: 0,
                    blue: 0
                }
            ],
            [ // COLORWHEEL
                {
                    pos: 0,
                    red: 100,
                    green: 100,
                    blue: 0
                }, {
                    pos: 20,
                    red: 0,
                    green: 80,
                    blue: 40
                }, {
                    pos: 30,
                    red: 0,
                    green: 100,
                    blue: 100
                }, {
                    pos: 50,
                    red: 10,
                    green: 10,
                    blue: 0
                }, {
                    pos: 65,
                    red: 100,
                    green: 0,
                    blue: 0
                }, {
                    pos: 88,
                    red: 100,
                    green: 40,
                    blue: 0
                }, {
                    pos: 100,
                    red: 100,
                    green: 100,
                    blue: 0
                }
            ],
            [ // COLORSPECTRUM
                {
                    pos: 0,
                    red: 0,
                    green: 75,
                    blue: 0
                }, {
                    pos: 22,
                    red: 0,
                    green: 90,
                    blue: 90
                }, {
                    pos: 37,
                    red: 0,
                    green: 0,
                    blue: 85
                }, {
                    pos: 49,
                    red: 90,
                    green: 0,
                    blue: 85
                }, {
                    pos: 68,
                    red: 90,
                    green: 0,
                    blue: 0
                }, {
                    pos: 80,
                    red: 90,
                    green: 90,
                    blue: 0
                }, {
                    pos: 100,
                    red: 95,
                    green: 95,
                    blue: 95
                }
            ],
            [ // SUNSET
                {
                    pos: 0,
                    red: 10,
                    green: 0,
                    blue: 23
                }, {
                    pos: 18,
                    red: 34,
                    green: 0,
                    blue: 60
                }, {
                    pos: 36,
                    red: 58,
                    green: 20,
                    blue: 47
                }, {
                    pos: 55,
                    red: 74,
                    green: 20,
                    blue: 28
                }, {
                    pos: 72,
                    red: 90,
                    green: 43,
                    blue: 0
                }, {
                    pos: 87,
                    red: 100,
                    green: 72,
                    blue: 0
                }, {
                    pos: 100,
                    red: 100,
                    green: 100,
                    blue: 76
                }
            ]
        ]
    };

    /** Pipe Size 
     * @private
     */
    m.PIPESIZE = 1024 * 1024;

    /**
     * Creates new file with header initialized to type-1000 defaults
     * and data appended. (tbd)
     * @param	{string}	filename	Name of File to Create
     * @param  	{array}		data		Input data buffer
     * @param  	{array}	  	overrides	List of fields/values to be overridden in the bluefile header
     * @return 	{header} 	hcb		Return <hcb> type-1000 bluefile header, filename=null
     */
    m.initialize = function(data, overrides) {
        var hcb = new BlueHeader(null);

        hcb.version = 'BLUE';
        hcb.size = 0;
        hcb.type = 1000;
        hcb.format = 'SF';
        hcb.timecode = 0.0;
        hcb.xstart = 0.0;
        hcb.xdelta = 1.0;
        hcb.xunits = 0;
        hcb.subsize = 1;
        hcb.ystart = 0.0;
        hcb.ydelta = 1.0;
        hcb.yunits = 0;

        if (!overrides) { /* if no overrides provided...set it to empty*/
            overrides = {};
        }

        for (var field in overrides) {
            hcb[field] = overrides[field];
        }
        hcb["class"] = hcb.type / 1000;

        if (!overrides.pipe) {
            hcb.setData(data);
        } else {
            hcb.pipe = true;
            hcb.in_byte = 0;
            hcb.out_byte = 0;
            // TODO round pipe size to nearest number of elements
            var pipesize = overrides.pipesize || m.PIPESIZE;

            hcb.buf = new ArrayBuffer(pipesize);
            hcb.setData(hcb.buf);
            hcb.data_free = hcb.dview.length;
        }

        return hcb;
    };

    /** 
     * Convert type-2000 header internals to force GRAB and FILAD routines to treat file as a 1000-type file.
     * @param	{header}	hcb		Bluefile header control block
     */
    m.force1000 = function(hcb) {
        if (hcb["class"] === 2) {
            hcb.size = hcb.subsize * hcb.size;
            hcb.bpe = hcb.bpe / hcb.subsize;
            hcb.ape = 1;
        }
    };

    /** 
     * Get data from file at specified start location.
     * @param	{header}	hcb		Bluefile header control block
     * @param	{array}		bufview		Data buffer to receive data
     * @param	{number}	start		Start location
     * @param	{number}	nget		Number of requested data
     * @return	{number}	ngot		Number of received data
     */
    m.grab = function(hcb, bufview, start, nget) {
        if (!hcb.dview) { return 0; }

        // TODO reformat
        if (hcb.format[0] === 'C') {
            start = start * 2;
        }

        nget = hcb.ape * nget; // TODO - this is never used????

        //var ngot = Math.min(bufview.length, (hcb.dview.length-start)); //mmm
        var ngot = Math.min(bufview.length, (hcb.dview.length - start));
        // iOS doesn't have .set on TypedArrays
        if (bufview.set === undefined) {
            for (var i = 0; i < ngot; i++) {
                bufview[i] = hcb.dview[start + i];
            }
        } else {
            bufview.set(hcb.dview.subarray(start, start + ngot));
        }
        if (hcb.format[0] === 'C') {
            ngot = ngot / 2;
        }
        return ngot;
    };

    /**
     * Append data buffer to file specified in the bluefile header control block.
     * @param	{header}	hcb		Bluefile header control block
     * @param	{array}		data		Data buffer
     * @param   {boolean}       [sync=false]    dispatch onpipewrite syncronously 
     */
    m.filad = function(hcb, data, sync) {
        if (hcb.data_free < data.length) {
            throw "Pipe full";
        }
        var sidx = hcb.in_byte / hcb.dview.BYTES_PER_ELEMENT;
        var eidx = (sidx + data.length);
        if (eidx > hcb.dview.length) {
            var head = hcb.dview.length - sidx;
            var tail = data.length - head;
	    if (data.subarray) {
              hcb.dview.set(data.subarray(0, head), sidx);
              hcb.dview.set(data.subarray(head, data.length), 0);
	    } else {
              hcb.dview.set(data.slice(0, head), sidx);
              hcb.dview.set(data.slice(head, data.length), 0);
	    }
            hcb.in_byte = (tail * hcb.dview.BYTES_PER_ELEMENT);
        } else {
            hcb.dview.set(data, sidx);
            hcb.in_byte = (eidx * hcb.dview.BYTES_PER_ELEMENT) % hcb.buf.byteLength;
        }
        hcb.data_free -= data.length;
        if (hcb.onwritelisteners) {
            for (var i = 0; i < hcb.onwritelisteners.length; i++) {
                if (!sync) {
                    window.setTimeout(hcb.onwritelisteners[i], 0);
                } else {
                    hcb.onwritelisteners[i]();
                }
            }
        }
    };

    /**
     * @param	{header}	hcb		Bluefile header control block
     * @return	{number}	elements available
     * @private
     */
    m.pavail = function(hcb) {
        return hcb.dview.length - hcb.data_free;
    };

    /**
     * Get data from file in dataflow fashion.
     * @param	{array}		hcb	Bluefile header control block
     * @param 	{array}		dview	Data buffer to receive data
     * @param	{number}	nget	Input variable name of parameter to receive data
     * @param	{number}	offset	Offset into file
     * @return	{number}	ngot	Number of data values gotten
     */
    // WARNING - nget is number of scalars...which differs from the normal API
    m.grabx = function(hcb, dview, nget, offset) {
	var navail = hcb.dview.length - hcb.data_free;
	if (offset === undefined) {
		offset = 0;
	}
	if (!nget) {
		nget = Math.min(dview.length-offset, navail);
	} else if (nget > dview.length-offset) {
		throw "m.grabx : nget larger then available buffer space";
	}
	if (nget < 0) {
		throw "m.grabx : nget cannot be negative";
	}
	if (nget > navail) {
		return 0;
	}

	var sidx = hcb.out_byte / hcb.dview.BYTES_PER_ELEMENT;
	var eidx = (sidx + nget);
	if (eidx >= hcb.dview.length) {
		var head = hcb.dview.length - sidx;
		eidx = eidx - hcb.dview.length;
		dview.set(hcb.dview.subarray(sidx, hcb.dview.length), offset);
		dview.set(hcb.dview.subarray(0, eidx), offset+head);
	} else {
		dview.set(hcb.dview.subarray(sidx, eidx), offset);
	}
	hcb.out_byte = (eidx * hcb.dview.BYTES_PER_ELEMENT) % hcb.buf.byteLength;
	hcb.data_free += nget;
        var ngot = nget;
        return ngot;
    };


    /**
     * @param	{header}	hcb		Bluefile header control block
     * @param	{number}	onwrite		-
     * @private
     */
    m.addPipeWriteListener = function(hcb, onwrite) {
        if (!hcb.onwritelisteners) {
            hcb.onwritelisteners = [];
        }
        if (hcb.onwritelisteners.indexOf(onwrite) === -1) {
            hcb.onwritelisteners.push(onwrite);
        }
    };

    /**
     * Returns ASCII description of units code
     * @param 	{number}	UNITS array index (see global UNITS)
     * @return 	{string}	ASCII code pair
     */
    // ~= M$UNITS_NAME
    m.units_name = function(units) {
        var u = UNITS[units];
        return u[0] + " (" + u[1] + ")";
    };

    /**
     * Extract filename from full path
     * @param 	{string}	pathfilename	Full path, including filename
     * @return	{string}	filename	    Trimmed filename
     */
    m.trim_name = function(pathfilename) {
        var i = pathfilename.indexOf(']');
        if (i === -1) {
            i = pathfilename.indexOf('/');
        }
        if (i === -1) {
            i = pathfilename.indexOf(':');
        }
        var j = pathfilename.substr(i + 1, pathfilename.length).indexOf('.');
        if (j < 0) {
            j = pathfilename.length - i;
        }
        var filename = pathfilename.substr(i + 1, i + j + 1);
        return filename;
    };

    /**
     * Takes an integer code for units and a multiplier and returns the string representation of the two.
     * Example: l = m.label(1,1.0e3) ==> l =  Time (Ksec)
     * @param 	{number}	units	Integer code for Unit (see global UNITS)
     * @param 	{number} 	mult	Units multiplier (i.e 1.0e3 ==> 'K')
     * @return {string} representation of units and multiplier
     */
    // ~= M$LABEL
    m.label = function(units, mult) {

        var u = UNITS[units];
        if (u === undefined) {
            return "";
        }
        var prefix = "?";
        if (mult === 1.0e3) {
            prefix = 'K';
        } else if (mult === 1.0e-3) {
            prefix = 'm';
        } else if (mult === 1.0e6) {
            prefix = 'M';
        } else if (mult === 1.0e-6) {
            prefix = 'u';
        } else if (mult === 1.0e9) {
            prefix = 'G';
        } else if (mult === 1.0e-9) {
            prefix = 'n';
        } else if (mult === 1.0e12) {
            prefix = 'T';
        } else if (mult === 1.0e-12) {
            prefix = 'p';
        } else if (mult === 1) {
            prefix = "";
        }
        return u[0] + " (" + prefix + u[1] + ")";
    };

    /** 
     * @private
     */
    var VECTOR = {
        MV: 'F', // vector type
        MS: 'F', // scalar type...not really necessary in javascript
        nbpt: 4,
        view: undefined
    };


    /**
     * Sets data type for all subsequent calls to vector libraries.  Remains in effect until another call to this routine.
     * @param ctype
     */
    // ~= VSTYPE - not really necessary
    m.vstype = function(ctype) {
        VECTOR.MS = ctype;
        VECTOR.MV = ctype;
        if (VECTOR.MV === 'D') {
            VECTOR.nbpt = 8;
        } else if ((VECTOR.MV === 'L') || (VECTOR.MV === 'F')) {
            VECTOR.nbpt = 4;
        } else if (VECTOR.MV === 'I') {
            VECTOR.nbpt = 2;
        } else if (VECTOR.MV === 'B') {
            VECTOR.nbpt = 1;
        } else {
            alert("Unsupported vector type");
        }
    };

    /**
     * For each vector element in <src>, determine the max of <src> element and <lo_thresh>, returns the log(base10) of that value in <dst>
     * @param	{array}		src		Input vector.
     * @param 	{number} 	lo_thresh	User-set minimum log threshold (if not defined, set default=1.0e-20). Prevent computing log of 0 or negative values.
     * @param 	{array}		dst		Ouput vector.  If undefined, <src> elements will be overwritten.
     */
    // ~= M$VLOG10- not really necessary
    m.vlog10 = function(src, lo_thresh, dst) {
        if (lo_thresh === undefined) {
            lo_thresh = 1.0e-20;
        }
        if (dst === undefined) {
            dst = src;
        }
        for (var i = 0; i < src.length; i++) {
            if (dst.length <= i) {
                break;
            }
            dst[i] = Math.log(Math.max(src[i], lo_thresh)) / Math.log(10);
        }
    };

    /**
     * Same as vlog10 but multiply each output value by a scale factor <dbscale>.
     * @param 	{array}		src		Input vector.
     * @param 	{number}	lo_thresh	User-set minimum log threshold.
     *                                              If undefined, defaults to 1.0e-20. Prevent computing log of 0 or negative values.
     * @param 	{number}	dbscale		Output scale factor. If undefined, defaults to 1.
     * @param 	{array}		dst		Output vector. If undefined, <src> elements will be overwritten.
     * @private
     */
    m.vlogscale = function(src, lo_thresh, dbscale, dst) {
        if (lo_thresh === undefined) {
            lo_thresh = 1.0e-20;
        }
        if (dbscale === undefined) {
            dbscale = 1;
        }
        if (dst === undefined) {
            dst = src;
        }
        for (var i = 0; i < src.length; i++) {
            if (dst.length <= i) {
                break;
            }
            dst[i] = Math.log(Math.abs(Math.max(src[i], lo_thresh))) / Math.log(10);
            dst[i] = dst[i] * dbscale;
        }
    };
    
    /**
     * Same as vlogscale but computes magnitude squared.
     *
     * @param 	{array}		src		Input vector.
     * @param 	{number}	lo_thresh	User-set minimum log threshold.
     *                                              If undefined, defaults to 1.0e-20. Prevent computing log of 0 or negative values.
     * @param 	{number}	dbscale		Output scale factor. If undefined, defaults to 1.
     * @param 	{array}		dst		Output vector. If undefined, <src> elements will be overwritten.
     * @private
     */
    m.cvmag2logscale = function(src, lo_thresh, dbscale, dst) {
        if (lo_thresh === undefined) {
            lo_thresh = 1.0e-20;
        }
        if (dbscale === undefined) {
            dbscale = 1;
        }
        if (dst === undefined) {
            dst = src;
        }
        var j = 0;
        for (var i = 0; i < dst.length; i++) {
            j = 2 * i + 1;
            if (j >= src.length) {
                break;
            }
            dst[i] = (src[j - 1] * src[j - 1]) + (src[j] * src[j]);
            dst[i] = Math.log(Math.abs(Math.max(dst[i], lo_thresh))) / Math.log(10);
            dst[i] = dst[i] * dbscale;
        }
    };

    /**
     * Multiply <count> elements of <src> by <mul>, store results in <dst>
     * @param	{array} 	src		Input vector.
     * @param	{number}	mul		Vector multiplier.
     * @param	{array}		dst		Output vector. If not defined, <src> elements will be overwritten.
     * @param	{number}	count		Number of elements to apply multiplier, starting with first <src> element.
     */
    // ~= M$VSMUL
    m.vsmul = function(src, mul, dst, count) {
        if (dst === undefined) {
            dst = src;
        }
        if (count === undefined) {
            count = dst.length;
        }
        count = Math.min(dst.length, count);
        count = Math.min(src.length, count);

        for (var i = 0; i < count; i++) {
            if (dst.length <= i) {
                break;
            }
            dst[i] = src[i] * mul;
        }
    };

    /**
     * Finds max and min values in vector <vec> and returns values.
     * @param 	{array}		vec		Input vector.
     * @param	{number}	size		Number of elements to search to find max.min values.
     * @return 	{array}		mxmin		Index and value of min and max elements in <vec>.
     */
    // ~= M$VMXMN
    m.vmxmn = function(vec, size) {
        // Originally this code used an object to hold the values
        // but Chrome 34.0.1847.131 seemed to have a bug where
        // these values would somehow get messed up...oddly
        // putting printouts or breakpoints prevented the
        // problem from showing up.
        var smax = vec[0];
        var smin = vec[0];
        var imax = 0;
        var imin = 0;
        size = Math.min(size, vec.length);
        for (var i = 0; i < size; i++) {
            if (vec[i] > smax) {
                smax = vec[i];
                imax = i;
            }
            if (vec[i] < smin) {
                smin = vec[i];
                imin = i;
            }
        }
        return {
            smax: smax,
            smin: smin,
            imax: imax,
            imin: imin
        };
    };

    /**
     * Move <count> elements from <src> to <dest>.  Stride is the distance between each array element in either or both the input and output vectors.
     * @param {array}	src		Input vector.
     * @param {number}	sstride		Input stride.
     * @param {array}	dest		Output vector.
     * @param {number}	dstride		Output stride.
     * @param {number}	count		Number of input vector elements to move, starting with 0th element of <vec>. Cannot exceed vector lengths,
     *					taking into account the strides.
     */
    m.vmov = function(src, sstride, dest, dstride, count) {
        if (count === undefined) {
            count = src.length;
        }
        count = Math.min(src.length, count);
        //count = Math.min(src.length, count, (count)*(dest.length)*(dstride)); //mmm-TODO

        for (var i = 0; i < count; i++) {
            var s = i * sstride;
            var d = i * dstride;
            if (s >= src.length) {
                break;
            }
            if (d >= dest.length) {
                break;
            }
            dest[d] = src[s];
        }
    };

    /**
     * Initialize <count> consecutive elements of input vector <vec> with value <inpval>.
     * @param	{array}		vec		Input vector
     * @param	{number}	inpval		Value
     * @param 	{number}	count		Number of elements to write, starting with 0th element of <vec>.  If undefined, entire <vec> is written.
     */
    // ~= M$VFILL
    // TODO - more optimal version?
    m.vfill = function(vec, inpval, count) {
        if (count === undefined) {
            count = vec.length;
        }
        count = Math.min(vec.length, count);
        for (var i = 0; i < count; i++) {
            vec[i] = inpval;
        }
    };

    /**
     * Compute the absolute value of <count> elements in <vec> and write to output vector <dest>
     * @param 	{array}		vec		Input vector.
     * @param 	{array}		dest		Ouput vector. If <dest> is undefined, overwrite input vector <vec>.
     * @param 	{number}	count		Number of elements to write, starting with 0th element of <vec>. Cannot exceed vector lengths.
     */
    m.vabs = function(vec, dest, count) {
        if (count === undefined) {
            count = vec.length;
        }
        if (dest === undefined) {
            dest = vec;
        }
        //count = Math.min(dest.length, count, vec.length); //mmm-TODO
        for (var i = 0; i < count; i++) {
            dest[i] = Math.abs(vec[i]);
        }
    };


    /**
     * Computes the magnitude of <count> complex vector <cxvec> elements. Store results in output vector <dest>.
     * @param	{array}		cxvec		Input vector
     * @param 	{array}		dest		Output vector
     * @param 	{number}	count		Number of elements to write, starting with 0th element of <cxvec>. Cannot exceed vector lengths.  If undefined, defaults to output vector <dest> length.
     */
    // ~= M$CVMAG
    m.cvmag = function(cxvec, dest, count) {
        if (count === undefined) {
            count = dest.length;
        }
        count = Math.min(dest.length, count);
        //count = Math.min(dest.length, count, cxvec.length); //mmm-TODO

        for (var i = 0; i < count; i++) {
            var j = 2 * i + 1;
            if (j >= cxvec.length) {
                break;
            }
            dest[i] = Math.sqrt((cxvec[j - 1] * cxvec[j - 1]) + (cxvec[j] * cxvec[j]));
        }
    };

    /**
     * Computes the magnitude squared of <count> complex vector <cxvec> elements. Store results in output vector <dest>.
     * @param	{array}		cxvec		Input vector
     * @param 	{array}		dest		Output vector
     * @param 	{number}	count		Number of elements to write, starting with 0th element of <cxvec>. Cannot exceed vector lengths.  If undefined, defaults to output vector <dest> length.
     */
    // ~= M$CVMAG2
    m.cvmag2 = function(cxvec, dest, count) {
        if (count === undefined) {
            count = dest.length;
        }
        count = Math.min(dest.length, count);
        //count = Math.min(dest.length, count, cxvec.length); //mmm-TODO

        var j = 0;
        for (var i = 0; i < count; i++) {
            j = 2 * i + 1;
            if (j >= cxvec.length) {
                break;
            }
            dest[i] = (cxvec[j - 1] * cxvec[j - 1]) + (cxvec[j] * cxvec[j]);
        }
    };

    /**
     * Computes phase in radians of <count> complex vector <cxvec> elements. Store results in output vector <dest>.
     * @param	{array}		cxvec		Input vector
     * @param 	{array}		dest		Output vector
     * @param 	{number}	count		Number of elements to write, starting with 0th element of <cxvec>. Cannot exceed vector lengths.  If undefined, defaults to output vector <dest> length.
     */
    // ~= M$CVPHA
    m.cvpha = function(cxvec, dest, count) {
        if (count === undefined) {
            count = dest.length;
        }
        count = Math.min(dest.length, count);
        //count = Math.min(dest.length, count, cxvec.length); //mmm-TODO

        var j = 0;
        var re = 0;
        var im = 0;
        for (var i = 0; i < count; i++) {
            j = 2 * i + 1;
            if (j >= cxvec.length) {
                break;
            }
            re = cxvec[j - 1];
            im = cxvec[j];
            if ((re === 0.0) && (im === 0.0)) {
                re = 1.0;
            }
            dest[i] = Math.atan2(im, re);
        }
    };

    /**
     * Computes the phase in degrees of <count> complex vector <cxvec> elements. Store results in output vector <dest>.
     * @param	{array}		cxvec		Input vector
     * @param 	{array}		dest		Output vector
     * @param 	{number}	count		Number of elements to write, starting with 0th element of <cxvec>. Cannot exceed vector lengths.  If undefined, defaults to output vector <dest> length.
     */
    // ~= M$CVPHAD
    m.cvphad = function(cxvec, dest, count) {
        if (count === undefined) {
            count = dest.length;
        }
        count = Math.min(dest.length, count);

        var j = 0;
        var re = 0;
        var im = 0;
        for (var i = 0; i < count; i++) {
            j = 2 * i + 1;
            if (j >= cxvec.length) {
                break;
            }
            re = cxvec[j - 1];
            im = cxvec[j];
            if ((re === 0.0) && (im === 0.0)) {
                re = 1.0;
            }
            dest[i] = Math.atan2(im, re) * (180.0 / Math.PI);
        }
    };

    /**
     * @param n
     * @private
     */
    // ~= INT(), DINT
    m.trunc = function(n) {
        return n - n % 1;
    };

    /**
     * @param a1
     * @param a2
     * @private
     */
    // Transfer of sign function from Fortran
    m.sign = function(a1, a2) {
        if (a2 >= 0) {
            return Math.abs(a1);
        } else {
            return -Math.abs(a1);
        }
    };

    /**
     * @method pad2
     * @param number
     * @private
     */

    function pad2(number) {
        return (number < 10 ? '0' : '') + number;
    }

    /**
     * Convert J1950 time or seconds-since-Epoch (midnight Dec-31-1949) to time-of-day. Fractional seconds accurate to milliseconds.
     * @param 	{number}	sec		Number of seconds.
     * @return	{string}	tod		Time of day
     */

    /* Output string can be in different forms as follows:
     * -31536000 <  sec < 0                   -DDD::HH:MM:SS
     *         0 <= sec < 86400                     HH:MM:SS
     *         86400 <= sec < 31536000         DDD::HH:MM:SS
     *         31536000 <=sec            YYYY:MM:DD:HH:MM:SS.<FFFFFF>
     *                                    where FFFFFF is in microseconds
     *
     */

    m.sec2tod = function(sec) {
        var tod = "";
        var j1950 = Date.UTC(1950, 0, 1); //From 1950 to 1970
        var j1950Date = new Date(j1950); //debug var
        var j1949 = Date.UTC(1949, 11, 31);
        var j1949Date = new Date(j1949); //debug var
        var d = new Date();
        var midnightToday = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
        var midnightTomorrow = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
        var midnightJan = new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);
        var midnightDec = new Date(d.getFullYear() + 1, 0, 1, 0, 0, 0);
        var diffDaySecs = (midnightTomorrow - midnightToday) / 1000; //    86400 secs = 24*60*60
        var diffYearSecs = (midnightDec - midnightJan) / 1000; // 31536000 secs = 365*24*60*60
        var negDiffYearSecs = -1 * diffYearSecs; //-31536000 secs

        if (sec >= 0) {
            if (sec < diffDaySecs) {
                // hh:mm:ss
                var millisecs = midnightToday.getTime() + (sec * 1000);
                var d = new Date(millisecs);
                tod = pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()) + ":" + pad2(d.getUTCMilliseconds());
            } else if (sec < diffYearSecs) {
                // ddd:hh:mm:ss
                var days = sec / diffDaySecs;
                days = [days > 0 ? Math.floor(days) : Math.ceil(days)];
                var d = new Date((sec * 1000) + midnightToday.getTime());
                tod = days.toString() + "::" + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()) + ":" + pad2(d.getUTCMilliseconds());
            } else {
                // convert to j1950
                var secMilli = sec * 1000 + j1950;
                d = new Date(secMilli);
                tod = d.getUTCFullYear() + ":" + pad2(d.getUTCMonth()) + ":" + pad2(d.getUTCDate()) + "::" +
                    pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes()) + ":" + pad2(d.getUTCSeconds()) + ":" + pad2(d.getUTCMilliseconds());
            }
        } else {
            if (sec > negDiffYearSecs) {
                // -ddd:hh:mm:ss
                var days = sec / diffDaySecs;
                days = [days <= 0 ? Math.ceil(days) : Math.floor(days)];
                var d = new Date(Math.abs(sec * 1000) + midnightToday.getTime());
                tod = days.toString() + "::" + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()) + ":" + pad2(d.getUTCMilliseconds());
            } else {
                // convert to j1950
                var secMilli = sec * 1000 + j1950;
                d = new Date(secMilli);
                tod = d.getUTCFullYear() + ":" + pad2(d.getUTCMonth()) + ":" + pad2(d.getUTCDate()) + "::" +
                    pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes()) + ":" + pad2(d.getUTCSeconds()) + ":" + pad2(d.getUTCMilliseconds());
            }
        }

        if ((sec % 1) !== 0) {
            tod += "." + (sec % 1).toPrecision(6).slice(2, 8);
        }

        return tod;

    };

    /**
     * @param 	{number}	sec		Number of seconds.
     * @return	{string}	tod		Time of day
     */

    m.sec2tod_j1970 = function(sec) {
        var tod = "";
	var d;
        if ((sec >= 0) && (sec < 86400)) {
            // hh:mm:ss
            d = new Date(sec * 1000);
            tod = pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());

        } else if ((sec < 0) && (sec > -31536000)) {
            // -ddd:hh:mm:ss
            var days = -1 * (sec / (24 * 60 * 60));
            d = new Date(sec * 1000);
            tod = days.toString() + "::" + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
        } else {
            // convert to j1950
            var j1950offset = (20.0 * 365.0 + 5.0) * (24 * 3600);
            d = new Date((sec - j1950offset) * 1000);
            tod = d.getFullYear() + ":" + pad2(d.getMonth()) + ":" + pad2(d.getDate()) + "::" +
                pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
        }
        if ((sec % 1) !== 0) {
            tod += "." + (sec % 1).toPrecision(6).slice(2, 8);
        }
        return tod;
    };

    /**
     * @private
     */
    // Throttle calls to "callback" routine and ensure that it
    // is not invoked any more often than "delay" milliseconds.
    //
    m.throttle = function(delay, callback) {
        var previousCall = new Date().getTime();
        return function() {
            var time = new Date().getTime();

            //
            // if "delay" milliseconds have expired since
            // the previous call then propagate this call to
            // "callback"
            //
            if ((time - previousCall) >= delay) {
                previousCall = time;
                callback.apply(null, arguments);
            }
        };
    };

}(window.m));

/**
 * @license
 * File: mx.js
 * Copyright (c) 2012-2014, Michael Ihde, All rights reserved.
 * Copyright (c) 2012-2014, Axios Inc., All rights reserved.
 *
 * This file is part of SigPlot.
 *
 * SigPlot is free software; you can redistribute it and/or modify it under the terms of the GNU Lesser
 * General Public License as published by the Free Software Foundation; either version 3.0 of the License, or
 * (at your option) any later version. This library is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE. See the GNU Lesser General Public License for more details. You should have received a copy of the
 * GNU Lesser General Public License along with SigPlot.
 */

/*jslint nomen: true, browser: true, devel: true*/

//Uses Immediately-invoked Function Expressions (IIFE)s for namespaces
//See http://addyosmani.com/blog/essential-js-namespacing/ for details.

/**
 * This namespace includes generic graphical routines and functions
 * the manipulate a canvas.
 *
 * @namespace
 */
window.mx = window.mx || {};

(function(mx, m, undefined) {
    /* global getKeyCode */
    /* global requestAnimFrame */
    /* global cancelAnimFrame */
    /* global tinycolor */
    /* global dashOn */
    /* global dashOff */
    /* global CanvasInput */

    mx.XW_INIT = -3;
    mx.XW_DRAW = 1;
    mx.XW_EVENT = 2;
    mx.XW_UPDATE = 3;
    mx.XW_COMMAND = 5;
    mx.SB_EXPAND = 1;
    mx.SB_SHRINK = 2;
    mx.SB_FULL = 3;
    mx.SB_STEPINC = 4;
    mx.SB_STEPDEC = 5;
    mx.SB_PAGEINC = 6;
    mx.SB_PAGEDEC = 7;
    mx.SB_DRAG = 8;
    mx.SB_WHEELUP = 9;
    mx.SB_WHEELDOWN = 10;

    // Grayscale colors:
    // "15%,15%,10%" - very dark gray
    // "25%,25%,20%" - dark gray
    // "35%,35%,30%" - medium gray
    // "40%,40%,35%" - light medium gray
    // "60%,60%,55%" - light gray
    // "70%,70%,65%" - very light gray	
    // "80%,80%,75%" - very very light gray

    mx.L_ArrowLeft = 1001;
    mx.L_ArrowRight = 1002;
    mx.L_ArrowUp = 1003;
    mx.L_ArrowDown = 1004;
    mx.L_dashed = 801;
    mx.GBorder = 3; // TODO Is this a good original value to use...?
    mx.L_RModeOff = 900;
    mx.L_RModeOn = 901;
    mx.L_PixelSymbol = 1;
    mx.L_CircleSymbol = 2;
    mx.L_SquareSymbol = 3;
    mx.L_PlusSymbol = 4;
    mx.L_XSymbol = 5;
    mx.L_TriangleSymbol = 6;
    mx.L_ITriangleSymbol = 7;
    mx.L_HLineSymbol = 8;
    mx.L_VLineSymbol = 9;

    /**
     * The zoom stack structure object
     * @private
     */
    mx.STKSTRUCT = function() {
        this.xmin = 0.0; // real world val at x1(origin=1,4) or x2(origin=2,4)
        this.xmax = 0.0; // real world val at x2(origin=1,4) or x1(origin=2,4)
        this.ymin = 0.0; // real world val at y2(origin=1,2) or y1(origin=3,4)
        this.ymax = 0.0; // real world val at y1(origin=1,2) or y2(origin=3,4)
        this.xscl = 0.0; // ratio of X real world units to pixel units
        this.yscl = 0.0; // ratio of Y real world units to pixel units
        this.x1 = 0; // left edge relative to window (pixels)
        this.y1 = 0; // top edge relative to window (pixels)
        this.x2 = 0; // right edge relative to window (pixels)
        this.y2 = 0; // bottom edge relative to window (pixels)
    };

    /**
     * The scrollbar structure object used to hold state about scrolling
     * @private
     */
    mx.SCROLLBAR = function() {
        this.flag = null; // int_4 // flag field for MX$SCROLLBAR routine
        this.action = null; // int_4 // returned action performed (XW_EVENT)
        this.smin = null;
        this.srange = null; // real_8 // real_8 // min and range values of scroll
        // bar
        this.tmin = null;
        this.trange = null; // real_8 // real_8 // min and range values of trough
        this.step = null; // real_8 // ratios of smin to move for step
        this.page = null; // real_8 // ratios of smin to move for page
        this.scale = null; // real_8 // ratio to scale by for expand/shrink
        this.dragoutline = null; // bool_4 // FALSE = smooth scroll, TRUE = drag &
        // drop
        this.initial_pause = null; // real_4
        this.repeat_pause = null; // real_4

        this.x = null;
        this.y = null;
        this.w = null;
        this.h = null; // int_2 // These fields are private and are to be
        this.s1 = null;
        this.sw = null;
        this.swmin = null;
        this.soff = null; // int_2 // set through other interfaces
        this.a1 = null;
        this.a2 = null;
        this.arrow = null; // int_2
        this.mxevent = null; // bool_1
        this.origin = null; // int_1
        this.repeat_count = null; // int_4
    };

    /**
     * @method WARPBOX
     * @private
     */
    function WARPBOX() {
        this.xo = 0;
        this.yo = 0;
        this.xl = 0;
        this.yl = 0;
        this.xmin = 0;
        this.xmax = 0;
        this.ymin = 0;
        this.ymax = 0;
        this.func = undefined;
        this.mode = undefined;
    }

    /**
     * Defines 2 canvas layers, canvas and wid_canvas
     * @method MX
     * @param element
     * @private
     */
    function MX(element) { // this is where the canvases are setup/defined
        this.root = element;

        // Create a div to hold all the various canvas layers
        this.parent = document.createElement('div');
        this.parent.style.position = "relative";
        //this.parent.style.height = "100%"; //element.clientHeight;
        //this.parent.style.width = "100%"; //element.clientHeight;
        //this.parent.clientWidth = element.clientWidth;
        this.parent.width = element.clientWidth;
        this.parent.height = element.clientHeight;
        element.appendChild(this.parent);

        // Create the canvas that will hold the plot
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = "absolute";
        this.canvas.style.top = "0px";
        this.canvas.style.left = "0px";
        this.canvas.width = element.clientWidth;
        this.canvas.height = element.clientHeight;

        this.parent.appendChild(this.canvas);
        this.active_canvas = this.canvas;

        // This canvas holds all widgets and reacts to mouse events
        this.wid_canvas = document.createElement('canvas');
        this.wid_canvas.style.position = "absolute";
        this.wid_canvas.style.top = "0px";
        this.wid_canvas.style.left = "0px";
        this.wid_canvas.style.zIndex = 1;
        this.wid_canvas.width = element.clientWidth;
        this.wid_canvas.height = element.clientHeight;

        this.parent.appendChild(this.wid_canvas);

        //if ((this.canvas.height <= 0) || (this.canvas.width <= 0)) {
        //	throw "Plot could not be instantiated correctly; did you specify a size for your placeholder?";
        //}

        this.text_w = 0; // text width
        this.text_h = 0; // text height
        this.level = 0; // current zoom level
        this.width = this.parent.width; // width of window
        this.height = this.parent.height; // height of window
        this.xpos = 0; // x-pixel loc of mouse during event
        this.ypos = 0; // y-pixel loc of mouse during event
        this.xmrk = 0.0; // absc coord of mark
        this.ymrk = 0.0;
        this.origin = 1;
        this.stk = [new mx.STKSTRUCT()]; // zoom stack

        mx.setbgfg(this, "black", "white");

        // Custom stuff for the Javascript implementation
        this.event_cb = undefined;
        this.warpbox = undefined;

        // draw_mode flags;
        this.rmode = false;
        this.linewidth = 1;
        this.style = undefined;
        this.xi = false;

        // Button Eventing variables
        this.button_release = 0;
        this.button_press = 0;
        this.state_mask = 0;

        // Specifies display field
        this.l = 0;
        this.r = this.width;
        this.t = 0;
        this.b = this.height;

        // Scrollbar state
        this.scrollbar_x = new mx.SCROLLBAR();
        this.scrollbar_y = new mx.SCROLLBAR();

        // Prompt mode state variable
        this.prompt = undefined;

        // Colormap
        this.pixel = [];

	// Render Canvas
	this._renderCanvas = document.createElement("canvas");
    }

    /**
     * Create Canvas and it's Mx structure and functions
     * @param {element}	element 	Reference to a DOM window element
     */
    /* Step #5*/
    mx.open = function(element) {
        var Mx = new MX(element); /* Step #6*/

        Mx.wid_canvas.oncontextmenu = function(event) {
            event.preventDefault();
            return false;
        };

        this._ctx = Mx.active_canvas.getContext("2d");

        Mx.onmousemove = (function(Mx) {
            return function(e) {
                var rect = e.target.getBoundingClientRect();
                Mx.xpos = (e.offsetX === undefined) ? (e.pageX - rect.left - window.scrollX) : e.offsetX;
                Mx.ypos = (e.offsetX === undefined) ? (e.pageY - rect.top - window.scrollY) : e.offsetY;

                //				Mx.xpos = (e.offsetX === undefined) ? e.layerX : e.offsetX;
                //				Mx.ypos = (e.offsetY === undefined) ? e.layerY : e.offsetY;

                if (Mx.warpbox) {
                    if ((e.ctrlKey) && (Mx.warpbox.alt_style !== undefined)) {
                        Mx.warpbox.style = Mx.warpbox.alt_style;
                    } else {
                        Mx.warpbox.style = Mx.warpbox.def_style;
                    }
                    mx.redraw_warpbox(Mx);
                }

                mx.widget_callback(Mx, e);
            };
        })(Mx);

        Mx.onmouseup = (function(Mx) {
            return function(event) {
                if (Mx.warpbox) {
                    mx.onWidgetLayer(Mx, function() {
                        mx.erase_window(Mx);
                    });

                    var old_warpbox = Mx.warpbox;
                    Mx.warpbox = undefined;

                    if (event.which === 1 || event.which === 3) {
                        if (old_warpbox.func) {
                            var xo = old_warpbox.xo;
                            var yo = old_warpbox.yo;
                            var xl = old_warpbox.xl;
                            var yl = old_warpbox.yl;

                            if (old_warpbox.mode === "vertical") {
                                xo = Mx.l;
                                xl = Mx.r;
                            } else if (old_warpbox.mode === "horizontal") {
                                yo = Mx.t;
                                yl = Mx.b;
                            } // else "box"
                            old_warpbox.func(event, xo, yo, xl, yl, old_warpbox.style.return_value);
                        }
                    }

                }
                mx.widget_callback(Mx, event);
            };
        })(Mx);

        Mx.onmousedown = (function(Mx) {
            return function(event) {
                event.preventDefault();
                mx.widget_callback(Mx, event);
                return false;
            };
        })(Mx);

        Mx.onkeydown = (function(Mx) {
            return function(event) {
                if (Mx.warpbox) {
                    var keyCode = getKeyCode(event);
                    if ((keyCode === 17) && (Mx.warpbox.style !== Mx.warpbox.alt_style)) { // CTRL
                        Mx.warpbox.style = Mx.warpbox.alt_style;
                        mx.redraw_warpbox(Mx);
                    }
                }

                mx.widget_callback(Mx, event);
            };
        })(Mx);

        Mx.onkeyup = (function(Mx) {
            return function(event) {
                if (Mx.warpbox) {
                    var keyCode = getKeyCode(event);
                    if ((keyCode === 17) && (Mx.warpbox.style !== Mx.warpbox.def_style)) { // CTRL
                        Mx.warpbox.style = Mx.warpbox.def_style;
                        mx.redraw_warpbox(Mx);
                    }
                }
            };
        })(Mx);

        Mx.ontouchend = (function(Mx) {
            return function(event) {
                Mx.onmouseup({
                    which: 1
                });
            };
        })(Mx);

        Mx.ontouchmove = (function(Mx) {
            return function(event) {
                // Compute the total offset - consider caching offset and only calculating on resize
                var element = Mx.canvas;
                var offsetX = 0;
                var offsetY = 0;
                if (element.offsetParent !== undefined) {
                    do {
                        offsetX += element.offsetLeft;
                        offsetY += element.offsetTop;
                    } while ((element = element.offsetParent));
                }

                Mx.xpos = event.targetTouches[0].pageX - offsetX;
                Mx.ypos = event.targetTouches[0].pageY - offsetY;
                mx.redraw_warpbox(Mx);
            };
        })(Mx);

        mx.enableListeners(Mx);

        return Mx;
    };

    /**
     * @param Mx
     * @private
     */
    mx.enableListeners = function(Mx) {
        mx.addEventListener(Mx, "mousemove", Mx.onmousemove, false);
        window.addEventListener("mouseup", Mx.onmouseup, false);
        mx.addEventListener(Mx, "mousedown", Mx.onmousedown, false);
        window.addEventListener("keydown", Mx.onkeydown, false);
        window.addEventListener("keyup", Mx.onkeyup, false);
        //mx.addEventListener(Mx, "touchend", Mx.ontouchend);
        //mx.addEventListener(Mx, 'touchmove', Mx.ontouchmove, false);

    };

    /**
     * @param Mx
     * @private
     */
    mx.disableListeners = function(Mx) {
        mx.removeEventListener(Mx, "mousemove", Mx.onmousemove, false);
        window.removeEventListener("mouseup", Mx.onmouseup, false);
        mx.removeEventListener(Mx, "mousedown", Mx.onmousedown, false);
        window.removeEventListener("keydown", Mx.onkeydown, false);
        window.removeEventListener("keyup", Mx.onkeyup, false);
        //mx.addEventListener(Mx, "touchend", Mx.ontouchend);
        //mx.addEventListener(Mx, 'touchmove', Mx.ontouchmove, false);
    };

    /**
     * @param Mx
     * @param event
     * @param callback
     * @param useCapture
     * @private
     */
    mx.addEventListener = function(Mx, event, callback, useCapture) {
        return Mx.wid_canvas.addEventListener(event, callback, useCapture);
    };

    /**
     * @param Mx
     * @param event
     * @param callback
     * @param useCapture
     * @private
     */
    mx.removeEventListener = function(Mx, event, callback, useCapture) {
        return Mx.wid_canvas.removeEventListener(event, callback, useCapture);
    };

    /**
     * @param Mx
     * @param event
     * @private
     */
    mx.dispatchEvent = function(Mx, event) {
        return Mx.wid_canvas.dispatchEvent(event);
    };

    /**
     * @param Mx
     * @param func
     * @private
     */
    mx.onWidgetLayer = function(Mx, func) {
        var current_active = Mx.active_canvas;
        Mx.active_canvas = Mx.wid_canvas;
        try {
            if (func) {
                return func();
            }
        } finally {
            Mx.active_canvas = current_active;
        }
    };

    /**
     * @param Mx
     * @param func
     * @private
     */
    mx.withWidgetLayer = function(Mx, func) {
        var f = function() {
            mx.onWidgetLayer(Mx, func);
        };
        return f;
    };

    /**
     * @param Mx
     * @param func
     * @private
     */
    mx.render = function(Mx, func) {
        if (!func) { return; }

        var active_canvas = Mx.active_canvas;

        if (!active_canvas._animationFrameHandle) {
            active_canvas._animationFrameHandle = requestAnimFrame(function() {
                active_canvas._animationFrameHandle = undefined;
                func();
            });
        }
    };

    /**
     * @param Mx
     * @param value
     * @private
     */
    mx.fullscreen = function(Mx, value) {
        if (value === undefined) {
            value = !Mx.fullscreen;
        }
        if (value) {
            Mx.fullscreen = {
                position: Mx.root.style.position,
                height: Mx.root.style.height,
                width: Mx.root.style.width,
                left: Mx.root.style.left,
                top: Mx.root.style.top,
                zIndex: Mx.root.style.zIndex
            };
            Mx.root.style.position = "fixed";
            Mx.root.style.height = "100%";
            Mx.root.style.width = "100%";
            Mx.root.style.left = "0px";
            Mx.root.style.top = "0px";
            Mx.root.style.zIndex = 16777271; // http://www.puidokas.com/max-z-index/
        } else {
            Mx.root.style.position = Mx.fullscreen.position;
            Mx.root.style.height = Mx.fullscreen.height;
            Mx.root.style.width = Mx.fullscreen.width;
            Mx.root.style.left = Mx.fullscreen.left;
            Mx.root.style.top = Mx.fullscreen.top;
            Mx.root.style.zIndex = Mx.fullscreen.zIndex;
            Mx.fullscreen = undefined;
        }
        mx.checkresize(Mx);
    };

    /**
     * @param Mx
     * @private
     */
    mx.checkresize = function(Mx) {
        var canvas = Mx.canvas;
        if ((canvas.height !== Mx.root.clientHeight) || (canvas.width !== Mx.root.clientWidth)) {

            Mx.height = Mx.root.clientHeight;
            Mx.width = Mx.root.clientWidth;

            Mx.canvas.height = Mx.height;
            Mx.canvas.width = Mx.width;
            Mx.wid_canvas.height = Mx.height;
            Mx.wid_canvas.width = Mx.width;

            return true;
        }
        return false;
    };

    /**
     * @param Mx
     * @private
     */
    mx.invertbgfg = function(Mx) {
        mx.setbgfg(Mx, Mx.fg, Mx.bg, !Mx.xi);
    };

    /**
     * @param color1
     * @param color2
     * @param color3
     * @private
     */
    mx.mixcolor = function(color1, color2, perc1to2) {
        var c1 = tinycolor(color1).toRgb();
        var c2 = tinycolor(color2).toRgb();
        var mix = 1.0 - perc1to2;
        c2.r = c1.r * mix + c2.r * perc1to2;
        c2.g = c1.g * mix + c2.g * perc1to2;
        c2.b = c1.b * mix + c2.b * perc1to2;
        return tinycolor(c2).toHexString(true);
    };

    /**
     * @param Mx
     * @param x
     * @param y
     * @param w
     * @param h
     * @param fillStyle
     * @private
     */
    mx.linear_gradient = function(Mx, x, y, w, h, fillStyle) {
        var ctx = Mx.active_canvas.getContext("2d");
        var step_size = 1.0 / fillStyle.length;
        var lingrad = ctx.createLinearGradient(x, y, w, h);
        for (var i = 0; i < fillStyle.length - 1; i++) {
            lingrad.addColorStop(step_size * (i), fillStyle[i]);
        }
        lingrad.addColorStop(1, fillStyle[fillStyle.length - 1]);
        return lingrad;
    };

    /**
     * Set's the background and foreground
     * xwfg : usually used for text on a widget
     * xwbg : background for a widget
     * @param Mx
     * @param bg
     * @param fg
     * @param xi
     * @private
     */
    mx.setbgfg = function(Mx, bg, fg, xi) {
        Mx.bg = bg;
        Mx.fg = fg;
        Mx.xi = xi;

        if ((tinycolor.equals(Mx.bg, "black")) && (tinycolor.equals(Mx.fg, "white"))) { ///mmm
            Mx.xwfg = Mx.fg; // X-Widget Foreground color
            Mx.xwbg = "rgb(35%,35%,30%)"; // X-Widget Background color
            Mx.xwts = "rgb(60%,60%,55%)"; // X-Widget top shadow color
            Mx.xwbs = "rgb(25%,25%,20%)"; // X-Widget bottom shadow color
            Mx.xwms = mx.mixcolor(Mx.xwts, Mx.xwbs, 0.5); // mid shadow
            Mx.xwlo = "rgb(15%,15%,10%)"; // X-Widget top shadow color
            Mx.hi = Mx.xwts; //  Highlight color
        } else if ((tinycolor.equals(Mx.bg, "white")) && (tinycolor.equals(Mx.fg, "black"))) {
            Mx.xwfg = Mx.fg; // X-Widget Foreground color
            Mx.xwbg = "rgb(60%,60%,55%)"; // X-Widget Background color
            Mx.xwts = "rgb(80%,80%,75%)"; // X-Widget top shadow color
            Mx.xwbs = "rgb(40%,40%,35%)"; // X-Widget bottom shadow color
            Mx.xwms = mx.mixcolor(Mx.xwts, Mx.xwbs, 0.5); // mid shadow
            Mx.xwlo = "rgb(70%,70%,65%)";
            Mx.hi = Mx.xwbs; //  Highlight color
        } else {
            var clr = tinycolor(Mx.bg).toRgb();
            var hsp = Math.sqrt( // HSP equation from http://alienryderflex.com/hsp.html
                0.299 * (clr.r * clr.r) +
                0.587 * (clr.g * clr.g) +
                0.114 * (clr.b * clr.b)
            );
            if (hsp > 127.5) { // light
                Mx.xwfg = "black";
                Mx.xwbg = "rgb(60%,60%,55%)"; // X-Widget Background color
                Mx.xwts = "rgb(80%,80%,75%)"; // X-Widget top shadow color
                Mx.xwbs = "rgb(40%,40%,35%)"; // X-Widget bottom shadow color
                Mx.xwms = mx.mixcolor(Mx.xwts, Mx.xwbs, 0.5); // mid shadow
                Mx.xwlo = "rgb(70%,70%,65%)";
                Mx.hi = Mx.xwts;
            } else { // dark
                Mx.xwfg = "white";
                Mx.xwbg = "rgb(35%,35%,30%)"; // X-Widget Background color
                Mx.xwts = "rgb(60%,60%,55%)"; // X-Widget top shadow color
                Mx.xwbs = "rgb(25%,25%,20%)"; // X-Widget bottom shadow color
                Mx.xwms = mx.mixcolor(Mx.xwts, Mx.xwbs, 0.5); // mid shadow
                Mx.xwlo = "rgb(15%,15%,10%)"; // X-Widget top shadow color
                Mx.hi = Mx.xwbs;
            }
        }
    };

    /**
     * @param Mx
     * @param theme
     * @private
     */
    mx.settheme = function(Mx, theme) {
        Mx.bg = theme.bg;
        Mx.fg = theme.fg;
        Mx.xi = theme.xi;
        Mx.xwfg = theme.xwfg;
        Mx.xwbg = theme.xwbg;
        Mx.xwts = theme.xwts;
        Mx.xwbs = theme.xwbs;
        Mx.xwlo = theme.xwlo;
        Mx.hi = theme.hi;
    };

    /**
     * Close graphics windows.
     * @param Mx
     */
    mx.close = function(Mx) {
        var canvas = Mx.wid_canvas;
        canvas.removeEventListener("mousemove", Mx.onmousemove, false);
        //canvas.removeEventListener("touchmove", Mx.ontouchmove);
        canvas.removeEventListener("mouseup", Mx.onmouseup, false);
        //canvas.addEventListener("touchend", Mx.onmouseup);

        if (Mx.parent && Mx.parent.parentNode) {
            Mx.parent.parentNode.removeChild(Mx.parent);
        }
    };

    /**
     * Draws and implements a scrollbar
     * @param Mx
     * @param sb
     * @param xs
     * @param xe
     * @param ys
     * @param ye
     * @param out
     * @param qs
     * @param qe
     * @param mouseEvent
     * @param scrollbarState
     */
    //
    // ~= MX$SCROLLBAR
    //
    mx.scrollbar = function(Mx, sb, xs, xe, ys, ye, out, qs, qe, mouseEvent, scrollbarState) {
        // Param types:
        // mx.SCROLLBAR* sb, 
        // int xs, int xe, int ys, int ye, 
        // real* ps, real* pe, real qs, real qe

        var mode; // an int
        var action; // an int
        var origin; // an int
        var stat = 0; // an int

        var step; // a real_8
        var page; // a real_8
        var scale; // a real_8
        var sblocal = new mx.SCROLLBAR(); // a SCROLLBAR

        mode = (sb.flag !== undefined ? sb.flag : sb); // REFACTOR - if user sends in a number instead of a scrollbar
        action = Math.abs(mode);

        if (ye - ys > xe - xs) {
            if (Mx.origin < 3) { origin = 2; /* inverted Y scrollbar */ }
            else { origin = 4; /* normal Y scrollbar */ }
        } else {
            if (Mx.origin & 2) { origin = 3; /* inverted X scrollbar */ }
            else { origin = 1; /* normal X scrollbar */ }
        }

        if (action < 10) { sb = sblocal; /* use local SB structure */ }
        if (action < 10 || sb.action === 0) { /* re-init the SB structure */
            mx.scroll(Mx, sb, mx.XW_INIT, undefined, scrollbarState);
            sb.flag = mode;
            /* Turn off repeated event handling in mx_scroll */
            sb.initial_pause = -1.0;
            mx.scroll_loc(sb, xs, ys, xe - xs + 1, ye - ys + 1, origin, scrollbarState);
        }
        sb.srange = out.pe - out.ps;

        switch (action) {
            case 0:
                step = page = scale = 1.0;
                break;
            case 1:
            case 11:
                step = page = 0.9 * sb.srange;
                scale = 2.0;
                break;
            case 2:
            case 12:
                step = 0.1 * sb.srange;
                page = 9 * step;
                scale = 2.0;
                break;
            case 3:
            case 13:
                step = 1.0;
                page = sb.srange - 1.0;
                scale = 1.0;
                break;
            default:
                return 0;
        }
        mx.scroll_vals(sb, out.ps, sb.srange, qs, qe - qs, step, page, scale, scrollbarState);

        if (mode === 0) {
            mx.scroll(Mx, sb, mx.XW_DRAW, undefined, undefined); // No need for a mouse event 
        } else {
            if (mx.scroll(Mx, sb, mx.XW_EVENT, mouseEvent, scrollbarState)) {
                if (out.ps !== sb.smin) {
                    out.ps = sb.smin;
                    stat += 1;
                }
                if (out.pe !== sb.smin + sb.srange) {
                    out.pe = sb.smin + sb.srange;
                    stat += 2;
                }
            }
        }
        return stat;
    };

    /**
     * Instantiate scrollbar on graphics window
     * @param Mx
     * @param sv
     * @param op
     * @param mouseEvent
     * @param scrollbarState
     */
    // 
    // ~= mx_scroll
    //
    mx.scroll = function(Mx, sv, op, mouseEvent, scrollbarState) {
        var btn; // an int
        var smin; // a real_8
        var srange; // a real_8
        var s; // an int_4

        if (sv === undefined) { return false; /* an mx.SCROLLBAR */ }

        switch (op) {
            case mx.XW_INIT:
                mx.scroll_loc(sv, 0, 0, Mx.width, 20, 1, scrollbarState);
                mx.scroll_vals(sv, 0.0, 10.0, 0.0, 100.0, 1.0, 10.0, 1.0, scrollbarState);
                sv.flag = 0;
                sv.action = 0;
                sv.initial_pause = 0.25;
                sv.repeat_pause = 0.05;
                sv.mxevent = true;
                sv.repeat_count = 0;
                break;
            case mx.XW_EVENT:
                /*  Determine which button, if any, was pressed/released
                 */
                btn = 0;
                if (sv.mxevent) { // TODO make sure mxevent is set properly when an event goes off - how is this supposed to be set?
                    btn = (Mx.button_release) ? -Mx.button_release : Mx.button_press;
                } else if (mouseEvent.type === "mousedown" || mouseEvent.type === "mouseup") {
                    // TODO Does this case ever happen?
                    switch (mouseEvent.which) {
                        case 1:
                            btn = 1;
                            break;
                        case 2:
                            btn = 2;
                            break;
                        case 3:
                            btn = 3;
                            break;
                            /* Add these cases for the mouse wheel */
                        case 4:
                            btn = 4;
                            break;
                        case 5:
                            btn = 5;
                            break;
                    }
                    if (mouseEvent.type === "mouseup") { btn = -btn; }
                } else if (mouseEvent.type === "mousewheel" || mouseEvent.type === "DOM-MouseScroll") {
                    // TODO Does this case ever happen?
                    if (mouseEvent.wheelDelta && mouseEvent.wheelDelta > 0) {
                        btn = 4; // TODO is 4 right for negative scroll (aka a scroll forwards away from the user)
                        // TODO Do we need to worry about a release here?
                    } else if (mouseEvent.wheelDelta && mouseEvent.wheelDelta < 0) {
                        btn = 5; // TODO is 5 right for negative scroll (aka a scroll backward towards the user)
                        // TODO Do we need to worry about a release here?
                    }
                }

                if (sv.action === 0) {
                    /*  First-time action -- only interested in button presses
                     *  1 or 2 within our bounds
                     */
                    /* If scroll wheel, pretend we're on vertical scroll bar */
                    if (btn === 4 || btn === 5) {
                        Mx.xpos = sv.x;
		    }


                    /* Button !=1,2,4,5 OR NOT on scroll bar */
                    if ((btn !== 1 && btn !== 2 && btn !== 4 && btn !== 5) ||
                        Mx.xpos < sv.x || Mx.ypos < sv.y ||
                        Mx.xpos > sv.x + sv.w || Mx.ypos > sv.y + sv.h) {
                        return false;
		    }
                } else if (btn < 0) {
                    /* Any button release within a repeated action will make us exit */
                    sv.action = sv.repeat_count = 0; // TODO Update scrollbarState's action?
                    return true;
                }

                /*  Compute s, the offset in pixels from the 'origin' of
                 *  the scrollbar's on-screen region.
                 */
                if (sv.origin & 1) {
                    s = Mx.xpos - sv.x;
                    if (sv.origin & 2) { s = sv.w - s; }
                } else {
                    s = Mx.ypos - sv.y;
                    if (sv.origin <= 2) { s = sv.h - s; }
                }

                /*  Determine action */
                if (sv.action === 0) {
                    /* First-time action */

                    sv.repeat_count = 0; // TODO Is repeat count necessary any more?

                    var scrollReal2PixOut = mx.scroll_real2pix(sv);
                    // UPDATE SCROLLBAR STATE as well
                    sv.s1 = scrollbarState.s1 = scrollReal2PixOut.s1;
                    sv.sw = scrollbarState.sw = scrollReal2PixOut.sw;
                    sv.soff = scrollbarState.soff = s - sv.s1;
                    if (sv.trange === 0.0) {
                        // UPDATE SCROLLBAR STATE as well
                        sv.smin = scrollbarState.smin = sv.tmin;
                        sv.srange = scrollbarState.srange = 0.0;
                    } else switch (btn) {
                        case 1:
                            if (s > sv.a1 && s < sv.a2) { /* on scroll trough */
                                sv.action = (sv.soff > 0) ? mx.SB_PAGEINC : mx.SB_PAGEDEC;
			    } else { /* on arrows */
                                sv.action = (sv.soff > 0) ? mx.SB_STEPINC : mx.SB_STEPDEC;
			    }
                            break;
                        case 4:
                            sv.action = mx.SB_WHEELUP;
                            break;
                        case 5:
                            sv.action = mx.SB_WHEELDOWN;
                            break;
                    }
                } else {
                    /* We're repeating sv.action */
                    switch (sv.action) {
                        case mx.SB_WHEELUP:
                        case mx.SB_WHEELDOWN:
                        case mx.SB_EXPAND:
                            /* we don't want to repeat these */
                        case mx.SB_SHRINK:
                        case mx.SB_FULL:
                            sv.action = sv.repeat_count = 0;
                    }
		}
                /* FALL THROUGH!!! */
                /* jshint -W086 */
            case mx.XW_COMMAND:
		/* jshint +W086 */

                smin = sv.smin;
                srange = sv.srange;

                switch (sv.action) {
                    case mx.SB_STEPINC:
                        smin += sv.step;
                        break;
                    case mx.SB_STEPDEC:
                        smin -= sv.step;
                        break;
                    case mx.SB_PAGEINC:
                        smin += sv.page;
                        break;
                    case mx.SB_PAGEDEC:
                        smin -= sv.page;
                        break;
                    case mx.SB_FULL:
                        smin = sv.tmin;
                        srange = sv.trange;
                        break;
                    case mx.SB_EXPAND:
                        srange = srange * sv.scale;
                        if (smin <= 0 && smin + sv.srange >= 0) { smin *= sv.scale; }
                        else { smin -= (srange - sv.srange) / 2.0; }
                        break;
                    case mx.SB_SHRINK:
                        srange = srange / sv.scale;
                        if (smin < 0 && smin + sv.srange >= 0) { smin += srange / sv.scale; /* Plot crosses axis */ }
                        else if (smin === 0 && smin + sv.srange >= 0) { smin = srange / sv.scale; /* Plot touches axis */ }
                        else { smin += (sv.srange - srange) / 2.0; /* Plot is completely contained on positive side of axis */ }
                        break;
                        /* The mouse wheel needs to scroll 1 page at a time, if you want an 
		           application to scroll differently, change sv.page with 
		           mx_scroll_vals in the application code */
                    case mx.SB_WHEELUP:
                        smin -= sv.page;
                        break;
                    case mx.SB_WHEELDOWN:
                        smin += sv.page;
                        break;
                }

                if (sv.trange > 0) {
                    smin = Math.max(sv.tmin, Math.min(smin, sv.tmin + sv.trange - srange));
                    srange = Math.min(srange, sv.trange);
                } else {
                    smin = Math.min(sv.tmin, Math.max(smin, sv.tmin + sv.trange - srange));
                    srange = Math.max(srange, sv.trange);
                }

                if (sv.smin === smin && sv.srange === srange) {
                    if (sv.action !== mx.SB_DRAG) { sv.action = sv.repeat_count = 0; }
                } else {
                    // UPDATE SCROLLBAR STATE as well
                    sv.smin = scrollbarState.smin = smin;
                    sv.srange = scrollbarState.srange = srange;
                    sv.repeat_count++;
                }

                if (op === mx.XW_COMMAND) {
                    mx.scroll(Mx, sv, mx.XW_UPDATE, undefined);
                    sv.action = 0;
                }

                break;
            case mx.XW_DRAW:
            case mx.XW_UPDATE:
                mx.redrawScrollbar(sv, Mx, op);

        } /* switch */
        return true;
    };

    /**
     * Specify location and orientation of a scrollbar
     * @param sv
     * @param x
     * @param y
     * @param w
     * @param h
     * @param origin
     * @param scrollbarState
     */
    //
    // ~= mx_scroll_loc
    //
    mx.scroll_loc = function(sv, x, y, w, h, origin, scrollbarState) {
        // UPDATE local scrollbar and SCROLLBAR STATE
        if (sv === undefined) { return; /* mx.SCROLLBAR */ }
        sv.x = scrollbarState.x = x; // int
        sv.y = scrollbarState.y = y; // int
        sv.w = scrollbarState.w = w; // int
        sv.h = scrollbarState.h = h; // int
        sv.origin = scrollbarState.origin = Math.max(1, Math.min(4, origin)); // int

        if (sv.origin & 1) {
            sv.a2 = scrollbarState.a2 = sv.w;
            sv.arrow = scrollbarState.arrow = Math.min(m.trunc((sv.w - m.trunc(2 * mx.GBorder)) / 3), sv.h + mx.GBorder);
        } else {
            sv.a2 = scrollbarState.a2 = sv.h;
            sv.arrow = scrollbarState.arrow = Math.min(m.trunc((sv.h - m.trunc(2 * mx.GBorder)) / 3), sv.w + mx.GBorder);
        }
        sv.a1 = scrollbarState.a1 = sv.arrow + mx.GBorder;
        sv.a2 -= sv.arrow + mx.GBorder;
        scrollbarState.a2 -= sv.arrow + mx.GBorder;
        sv.swmin = scrollbarState.swmin = Math.min(10, sv.a2 - sv.a1);
        sv.s1 = scrollbarState.s1 = 0;
        sv.sw = scrollbarState.sw = 0;
        sv.action = scrollbarState.action = 0;
    };

    /**
     * Set coordinates in scrollbar structure
     * @param sv
     * @param smin
     * @param srange
     * @param tmin
     * @param trange
     * @param step
     * @param page
     * @param scale
     * @param scrollbarState
     */
    //
    // ~= mx_scroll_vals
    //
    mx.scroll_vals = function(sv, smin, srange, tmin, trange, step, page, scale, scrollbarState) {
        // UPDATE SCROLLBAR STATE as well
        if (sv === undefined) { return; /* an mx.SCROLLBAR */ }
        sv.smin = scrollbarState.smin = smin;
        sv.srange = scrollbarState.srange = srange;
        sv.tmin = scrollbarState.tmin = tmin;
        sv.trange = scrollbarState.trange = trange;
        sv.step = scrollbarState.step = step;
        sv.page = scrollbarState.page = page;
        sv.scale = scrollbarState.scale = Math.max(scale, 1.0);
    };

    /**
     * Draw single symbol centered at pixel (x,y)
     * @param Mx
     * @param ic
     * @param x
     * @param y
     * @param symbol
     * @param rr
     */
    //
    // ~= MX$DRAW_SYMBOL
    //
    mx.draw_symbol = function(Mx, ic, x, y, symbol, rr) {
        var pixx = new Int32Array(new ArrayBuffer(4 * 1));
        var pixy = new Int32Array(new ArrayBuffer(4 * 1));

        pixx[0] = x;
        pixy[0] = y;
        mx.draw_symbols(Mx, ic, pixx, pixy, 1, symbol, rr);
    };

    /**
     * Plot symbols at centers defined by an array of pixels
     * @param Mx
     * @param ic
     * @param pixx
     * @param pixy
     * @param npix
     * @param symbol
     * @param rr
     * @private
     */
    //
    // ~= MX$DRAW_SYMBOLS
    //
    mx.draw_symbols = function(Mx, ic, pixx, pixy, npix, symbol, rr) {
        // TODO:
        // -XOR color support
        // -PostScript file printing

        var ctx = Mx.active_canvas.getContext("2d");

        var i = 0; // int
        var r = 0; // int
        var d = 0; // int
        var x = 0; // int
        var y = 0; // int
        var rmode = false; // bool
        var fill = false; // bool
        var tri = []; // XPoint array of size 4
        for (var cnt = 0; cnt < 4; cnt++) { // initializing 4 points in the array
            tri[cnt] = {
                x: 0,
                y: 0
            };
        }

        var c = ''; // char

        fill = rr < 0;
        r = Math.abs(rr);
        d = r * 2;

        // Set the foreground color
        ctx.fillStyle = ic;
        ctx.strokeStyle = ic;

        // TODO Commented out XOR for now
        // Can we just have an input parameter that says whether or not we're in xor mode or not?
        // if (ic === L_XORColor) { // If chosen color is the L_XORColor...
        // 		rmode = Mx.rmode;
        // }
        // else {
        // 		rmode = false;
        // }

        switch (symbol) {
            case mx.L_CircleSymbol:
                for (i = 0; i < npix; i++) {
                    // Move x and y to center of circle - not upper-left of bounding rectangle (aka offset by radius)
                    var x_center = pixx[i];
                    var y_center = pixy[i];

                    ctx.beginPath();
                    if (fill) {
                        // TODO Postscript support:
                        //					if (f_PostScript) mx_psdraw_objects(ic, pix, npix, r, "Dot fill");
                        ctx.arc(x_center, y_center, r, 0, 360); // draw arc
                        ctx.fill(); // fill in the area of the arc
                    } else {
                        // TODO Postscript support:
                        //					if (f_PostScript) mx_psdraw_objects(ic, pix, npix, r, "Dot S");

                        // TODO Commented out XOR-related stuff for now
                        // if (rmode && (gc = G.gcr)) {
                        //	  x_center += r;
                        //    y_center += r;
                        // }
                        ctx.arc(x_center, y_center, r, 0, 360);
                        ctx.stroke(); // just draw the arc's outline
                    }
                }
                break;
            case mx.L_SquareSymbol:
                if (fill) {
                    // TODO Postscript support:
                    //				if (f_PostScript) mx_psdraw_objects(ic, pix, npix, r, "sq fill");
                    for (i = 0; i < npix; i++) {
                        fill_rectangle(ctx, pixx[i] - r, pixy[i] - r, d, d);
                    }
                } else {
                    // TODO Postscript support:
                    //				if (f_PostScript) mx_psdraw_objects(ic, pix, npix, r, "sq S");
                    for (i = 0; i < npix; i++) {
                        draw_rectangle(ctx, pixx[i] - r, pixy[i] - r, d, d);
                    }
                    // TODO Commented out XOR-related stuff for now
                    // if (rmode && (gc=G.gcr)) {
                    // 		++r; d += 2;
                    //      for (i = 0; i < npix; i++)
                    //      	draw_rectangle(ctx, pixx[i] - r, pixy[i] - r, d, d);
                    // }
                }
                break;
            case mx.L_PixelSymbol:
                // TODO Postscript support:
                //			if (f_PostScript) mx_psdraw_objects(ic, pix, npix, rr, "Dot S");
                d = 1; // d = 2*GMaxLines; // TODO Do we care about a maximum number of lines?
                for (i = 0; i < npix; i += d) {
                    // No native way to draw just a pixel - so use a circle instead
                    ctx.beginPath();
                    ctx.arc(pixx[i], pixy[i], 1, 0, 2 * Math.PI, true);
                    ctx.fill();
                }
                break;
            case mx.L_ITriangleSymbol:
                r = -r; // TODO Refactor without switch fall-through?
	    /* jshint -W086 */
            case mx.L_TriangleSymbol:
	    /* jshint +W086 */
                d = m.trunc(r * 1.5);
                x = m.trunc(r * 0.80);

                // Coordinates of just the triangle itself
                tri[1].x = -x;
                tri[1].y = d;
                tri[2].x = x * 2;
                tri[2].y = 0;
                tri[3].x = -x;
                tri[3].y = -d;

                var tempTri = []; // XPoint array of size 4
                for (var cnt = 0; cnt < 4; cnt++) { // initializing 4 points in the array
                    tempTri[cnt] = {
                        x: 0,
                        y: 0
                    };
                }

                if (fill) {
                    // TODO Postscript support:
                    //				if (f_PostScript) mx_psdraw_objects(ic, pix, npix, r, "Tri fill");
                    for (i = 0; i < npix; i++) {
                        tempTri[0].x = pixx[i];
                        tempTri[0].y = pixy[i] - r;

                        // Replacement for CoordModePrevious offset (updating coordinates to be relative to origin, instead of previous pt)
                        tempTri[1].x = tempTri[0].x + tri[1].x;
                        tempTri[1].y = tempTri[0].y + tri[1].y;
                        tempTri[2].x = tempTri[1].x + tri[2].x;
                        tempTri[2].y = tempTri[1].y + tri[2].y;
                        tempTri[3].x = tempTri[2].x + tri[3].x;
                        tempTri[3].y = tempTri[2].y + tri[3].y;

                        fill_poly(ctx, tempTri);
                    }
                } else {
                    // TODO Postscript support:
                    //				if (f_PostScript) mx_psdraw_objects(ic, pix, npix, r, "Tri S");
                    for (i = 0; i < npix; i++) {
                        tempTri[0].x = pixx[i];
                        tempTri[0].y = pixy[i] - r;

                        // Replacement for CoordModePrevious offset (updating coordinates to be relative to origin, instead of previous pt)
                        tempTri[1].x = tempTri[0].x + tri[1].x;
                        tempTri[1].y = tempTri[0].y + tri[1].y;
                        tempTri[2].x = tempTri[1].x + tri[2].x;
                        tempTri[2].y = tempTri[1].y + tri[2].y;
                        tempTri[3].x = tempTri[2].x + tri[3].x;
                        tempTri[3].y = tempTri[2].y + tri[3].y;

                        draw_poly(ctx, tempTri);
                    }
                    //				 if (rmode && (gc = G.gcr)) {
                    //				 		if (r >= 0) { 
                    //							++r; ++x; d += 2; 
                    //						} else { 
                    //							--r; --x; d -= 2; 
                    //						}
                    //						tri[1].x = -x;
                    //						tri[1].y = d;
                    //						tri[2].x = x * 2;
                    //						tri[2].y = 0;
                    //						tri[3].x = -x;
                    //						tri[3].y = -d;
                    //		
                    //				 		for (i = 0; i < npix; i++) {
                    //							tempTri[0].x = pixx[i];
                    //							tempTri[0].y = pixy[i] - r;
                    //				
                    //							// Replacement for CoordModePrevious offset (updating coordinates to be relative to origin, instead of previous pt)
                    //							tempTri[1].x = tempTri[0].x + tri[1].x;
                    //							tempTri[1].y = tempTri[0].y + tri[1].y;
                    //							tempTri[2].x = tempTri[1].x + tri[2].x;
                    //							tempTri[2].y = tempTri[1].y + tri[2].y;
                    //							tempTri[3].x = tempTri[2].x + tri[3].x;
                    //							tempTri[3].y = tempTri[2].y + tri[3].y;
                    //
                    //				 			draw_poly(ctx, tempTri);
                    //				 		}
                    //				 }
                }
                break;
            case mx.L_PlusSymbol:
                // TODO Postscript support:
                //			if (f_PostScript) mx_psdraw_objects(ic, pix, npix, r, "Plus S");
                for (i = 0; i < npix; i++) {
                    x = pixx[i];
                    y = pixy[i];
                    draw_line(ctx, x, y + r, x, y - r);
                    draw_line(ctx, x + r, y, x - r, y);
                }
                //			if (rmode && (gc = G.gcr)) {
                //				for (i = 0; i < npix; i++) {
                //					x = pixx[i] - 1;
                //					y = pixy[i] + 1;
                //					draw_line(ctx, x, y + r, x, y - r);
                //					draw_line(ctx, x + r, y, x - r, y);  
                //				}
                //			}
                break;
            case mx.L_HLineSymbol:
                // TODO Postscript support:
                //                     if (f_PostScript) mx_psdraw_objects(ic, pix, npix, r, "Plus S");
                for (i = 0; i < npix; i++) {
                    x = pixx[i];
                    y = pixy[i];
                    draw_line(ctx, x + r, y, x - r, y);
                }
                //                     if (rmode && (gc = G.gcr)) {
                //                             for (i = 0; i < npix; i++) {
                //                                     x = pixx[i] - 1;
                //                                     y = pixy[i] + 1;
                //                                     draw_line(ctx, x, y + r, x, y - r);
                //                                     draw_line(ctx, x + r, y, x - r, y);  
                //                             }
                //                     }
                break;
           case mx.L_VLineSymbol:
                // TODO Postscript support:
                //                     if (f_PostScript) mx_psdraw_objects(ic, pix, npix, r, "Plus S");
                for (i = 0; i < npix; i++) {
                    x = pixx[i];
                    y = pixy[i];
                    draw_line(ctx, x, y + r, x, y - r);
                }
                //                     if (rmode && (gc = G.gcr)) {
                //                             for (i = 0; i < npix; i++) {
                //                                     x = pixx[i] - 1;
                //                                     y = pixy[i] + 1;
                //                                     draw_line(ctx, x, y + r, x, y - r);
                //                                     draw_line(ctx, x + r, y, x - r, y);  
                //                             }
                //                     }
                break;
            case mx.L_XSymbol:
                // TODO Postscript support:
                //			if (f_PostScript) mx_psdraw_objects(ic, pix, npix, r, "XSym S");
                for (i = 0; i < npix; i++) {
                    x = pixx[i];
                    y = pixy[i];
                    draw_line(ctx, x - r, y - r, x + r, y + r);
                    draw_line(ctx, x + r, y - r, x - r, y + r);
                }
                // TODO Commented out XOR-related stuff for now
                //			if (rmode && (gc = G.gcr)) {
                //				d = r - 1; ++r;
                //				for (i = 0; i < npix; i++) {
                //					x = pixx[i];
                //					y = pixy[i];
                //					draw_line(ctx, x - r, y - d, x + d, y + r);
                //					draw_line(ctx, x + d, y - r, x - r, y + d);
                //				}
                //			}
                break;
            default:
                c = symbol;
                r = m.trunc(Mx.text_w / 2); //tbd
                // TODO Postscript support:      
                //			if (f_PostScript) {
                //				char astr[80];
                //				sprintf(astr, "(%c) Char", c);
                //				mx_psdraw_objects(ic, pix, npix, r, astr);
                //			}
                if (fill && !rmode) {
                    for (i = 0; i < npix; i++) {
                        ctx.fillText(c.substring(0, 2), pixx[i] - r, pixy[i] + r); // TODO Does this cover it? Do we need to also fill in a rectangle behind 
                    }
                }
                // TODO Commented out XOR-related stuff for now
                //			else {
                //				ctx.textBaseline = "alphabetic"; // TODO Verify this is necessary
                //				for (i = 0; i < npix; i++) {
                //					ctx.fillText(c.substring(0,2), pixx[i] - r, pixy[i] + r);
                //				}
                //			}
                break;
        }
    };

    /* http://geomalgorithms.com/a01-_area.html
     *   > 0 left
     *   = 0 on
     *   < 0 right
     */
    /**
     * Test if a point is Left|On|Right of an infinite 2D line.
     * @method isLeft
     * @param p_x Point's x-coordinate
     * @param p_y Point's y-coordinate
     * @param e_x1 Lines's x1-coordinate
     * @param e_y1 Lines's y1-coordinate
     * @param e_x2 Lines's x2-coordinate
     * @param e_y2 Lines's y2-coordinate
     * @private
     */
    function isLeft(p_x, p_y, e_x1, e_y1, e_x2, e_y2) {
        return ((e_x1 - p_x) * (e_y2 - p_y) - (e_x2 - p_x) * (e_y1 - p_y));
    }

    /**
     * @method update_winding_number
     * @param wn
     * @param p_x
     * @param p_y
     * @param e_x1
     * @param e_y1
     * @param e_x2
     * @param e_y2
     * @private
     */
    function update_winding_number(wn, p_x, p_y, e_x1, e_y1, e_x2, e_y2) {
        if (e_y1 <= p_y) { // start y <= P.y
            if (e_y2 > p_y) { // an upward crossing
                if (isLeft(p_x, p_y, e_x1, e_y1, e_x2, e_y2) > 0) {
                    wn += 1;
                }
            }
        } else { // start y > P.y (no test needed)
            if (e_y2 <= p_y) { // a downward crossing
                if (isLeft(p_x, p_y, e_x1, e_y1, e_x2, e_y2) < 0) {
                    wn -= 1;
                }
            }
        }
        return wn;
    }

    /**
     * Converts array of (x,y) coordinates to pixel coordinates, plots lines or dots
     * @param Mx
     * @param color
     * @param xpoint
     * @param ypoint
     * @param npts
     * @param skip
     * @param line
     * @param symb
     * @param rad
     * @param options
     */
    //
    // ~= MX$TRACE
    //
    mx.trace = function(Mx, color, xpoint, ypoint, npts, skip, line, symb, rad, options) {
        if ((xpoint === undefined) || (ypoint === undefined)) {
            throw "mx.trace requires xpoint and ypoint";
        }

        if (skip === undefined) {
            skip = 1;
        }

        if (line === undefined) {
            line = 1;
        }

        if (symb === undefined) {
            symb = 0;
        }

        if (rad === undefined) {
            rad = 0;
        }

        if (options === undefined) {
            options = {};
        }

        if (npts <= 0) {
            m.log.warn("No points to draw");
            return;
        }

        if ((line === 0) && (symb === 0)) {
            m.log.warn("No line or symbol to draw");
            return;
        }

        var style;
        if (options.dashed) {
            style = {
                mode: "dashed",
                on: 4,
                off: 4
            };
        }

        var stk4 = mx.origin(Mx.origin, 4, Mx.stk[Mx.level]);
        if ((stk4.xscl === 0.0) || (stk4.yscl === 0.0)) {
            // the min and max are the same
            return;
        }

        var left = stk4.x1;
        var top = stk4.y1;

        var xxmin = stk4.xmin;
        var xscl = 1.0 / stk4.xscl;

        var yymin = stk4.ymin;
        var yscl = 1.0 / stk4.yscl;

        if (!options.noclip) {
            mx.clip(Mx, left, top, stk4.x2 - left + 1, stk4.y2 - top + 1);
        }

        var dx = Math.abs(stk4.xmax - stk4.xmin);
        var dy = Math.abs(stk4.ymax - stk4.ymin);
        var xmin = Math.min(stk4.xmin, stk4.xmax);
        var ymin = Math.min(stk4.ymin, stk4.ymax);
        var xmax = xmin + dx;
        var ymax = ymin + dy;
        //dx = dx * 0.5;
        //if ((line == -1) || (line == 1)) {
        //	dy = dy * 10.0;
        //} else {
        //	dy = dy * 0.5;
        //}
        //xmin = xmin - dx;
        //ymin = ymin - dy;
        //xmax = xmax + dx;
        //ymax = ymax + dy;


        // These buffers need to be able to hold 4/3 the number of points.
        // If all three points are on the screen than you need exactly xpoint.length.
        // If all three points are off the screen, then this turns into four
        // points.
        var bufsize = 4 * Math.ceil(1.33 * xpoint.length);
        var pixx = new Int32Array(new ArrayBuffer(bufsize));
        var pixy = new Int32Array(new ArrayBuffer(bufsize));

        var ib = 0;
        if (line === 0) {
            for (var n = (skip - 1); n <= npts; n += skip) {
                var x = xpoint[n];
                var y = ypoint[n];
                var lvisible = ((x >= xmin) && (x <= xmax) && (y >= ymin) && (y <= ymax));
                if (lvisible) {
                    pixx[ib] = Math.round((x - xxmin) * xscl) + left;
                    pixy[ib] = Math.round((y - yymin) * yscl) + top;
                    ib += 1;
                }
            }
            if (symb !== 0 && ib > 1) { mx.draw_symbols(Mx, color, pixx.subarray(0), pixy.subarray(0), ib, symb, rad); }
        } else if (options.vertsym === true) {
            for (var n = (skip - 1); n <= npts; n += skip) {
                var x = xpoint[n];
                var y = ypoint[n];
                if ((x >= xmin) && (x <= xmax)) {
                    var i = Math.round((x - xxmin) * xscl) + left;
                    mx.draw_line(Mx, color, i, 0, i, Mx.height);
                    if ((y >= ymin) && (y <= ymax)) {
                        pixx[ib] = i;
                        pixy[ib] = Math.round((y - yymin) * yscl) + top;
                        ib += 1;
                    }
                }
            }
            if (symb !== 0 && ib > 1) { mx.draw_symbols(Mx, color, pixx.subarray(0), pixy.subarray(0), ib, symb, rad); }
        } else if (options.horzsym === true) {
            for (var n = (skip - 1); n <= npts; n += skip) {
                var x = xpoint[n];
                var y = ypoint[n];
                if ((y >= ymin) && (y <= ymax)) {
                    var i = Math.round((y - yymin) * yscl) + top;
                    mx.draw_line(Mx, color, 0, i, Mx.width, i);
                    if ((x >= xmin) && (x <= xmax)) {
                        pixx[ib] = Math.round((x - xxmin) * xscl) + left;
                        pixy[ib] = i;
                        ib += 1;
                    }
                }
            }
            if (symb !== 0 && ib > 1) { mx.draw_symbols(Mx, color, pixx.subarray(0), pixy.subarray(0), ib, symb, rad); }
        } else {
            var colors;
            if ((options) && (options.highlight)) {
                colors = [];
                colors.push({
                    start: left,
                    color: color
                });

                for (var sn = 0; sn < options.highlight.length; sn++) {
                    if (options.highlight[sn].xstart >= xmax) { continue; }
                    if (options.highlight[sn].xend <= xmin) { continue; }

                    var xs = Math.max(options.highlight[sn].xstart, xmin);
                    var xe = Math.min(options.highlight[sn].xend, xmax);

                    if (xs < xe) {
                        var rxs = Math.round((xs - xxmin) * xscl) + left;
                        var rxe = Math.round((xe - xxmin) * xscl) + left;

                        colors.push({
                            start: rxs,
                            end: rxe,
                            color: options.highlight[sn].color
                        });
                    }
                }

                colors.sort(function(a, b) {
                    return a.start - b.start;
                });

            } else {
                colors = color;
            }

            var wn = 0; // the winding number counter http://geomalgorithms.com/a03-_inclusion.html
            var mid_x = (Mx.stk[Mx.level].xmax + Mx.stk[Mx.level].xmin) / 2.0;
            var mid_y = (Mx.stk[Mx.level].ymax + Mx.stk[Mx.level].ymin) / 2.0;

            var x = xpoint[0];
            var y = ypoint[0];

            wn = update_winding_number(wn, mid_x, mid_y, Mx.stk[Mx.level].xmin, Mx.stk[Mx.level].ymin, x, y);

            var lvisible = ((x >= xmin) && (x <= xmax) && (y >= ymin) && (y <= ymax));
            // The first point is visible
            if (lvisible) {
                pixx[ib] = Math.round((x - xxmin) * xscl) + left;
                pixy[ib] = Math.round((y - yymin) * yscl) + top;
                ib += 1;
                if (symb !==0) { mx.draw_symbols(Mx, color, pixx, pixy, 1, symb, rad); }
            } else {
                ib = 0;
            }

            var ie = 0;
            var visible = false;
            for (var n = skip; n <= (skip * (npts - 1)); n += skip) {

                var lx = x;
                var ly = y;
                x = xpoint[n];
                y = ypoint[n];

                wn = update_winding_number(wn, mid_x, mid_y, lx, ly, x, y);

                visible = ((x >= xmin) && (x <= xmax) && (y >= ymin) && (y <= ymax));
                if ((lvisible) && (visible)) {
                    // both the left point and right point are visible, so we can draw the trace
                    pixx[ib] = Math.round((x - xxmin) * xscl) + left;
                    pixy[ib] = Math.round((y - yymin) * yscl) + top;
                    ib += 1;
                } else {
                    // clipping necessary, either the left or right point are not visible
                    lvisible = visible;
                    // calculate the difference between the last point and this point
                    dx = lx - x;
                    dy = ly - y;
                    if ((dx !== 0.0) || (dy !== 0.0)) {
                        var o = {
                            tL: 1.0,
                            tE: 0.0
                        };
                        // Between the last point and the current point,
                        // determine the ratio of the x and y porionts
                        // that intersects the border.  If clipt returns
                        // false then no portion of the line between the two
                        // points is visible
                        if (clipt(dx, xmin - x, o)) {
                            if (clipt(-dx, x - xmax, o)) {
                                if (clipt(dy, ymin - y, o)) {
                                    if (clipt(-dy, y - ymax, o)) {
                                        // If this point is starting the on-screen portion, start the line
                                        if (o.tL < 1) {
                                            pixx[ib] = Math.round((x - xxmin + o.tL * dx) * xscl) + left;
                                            pixy[ib] = Math.round((y - yymin + o.tL * dy) * yscl) + top;
                                            ib += 1;
                                        }

                                        // If this point is ending the on-screen portion draw the line
                                        if (o.tE > 0) {
                                            pixx[ib] = Math.round((x - xxmin + o.tE * dx) * xscl) + left;
                                            pixy[ib] = Math.round((y - yymin + o.tE * dy) * yscl) + top;
                                            ib += 1;
                                            mx.draw_lines(Mx, colors, pixx.subarray(ie, ib), pixy.subarray(ie, ib), (ib - ie), line, style);

                                            if (symb !== 0 && (ib - ie) > 2) {
                                                mx.draw_symbols(Mx, color, pixx.subarray(ie + 1, ib), pixy.subarray(ie + 1, ib), (ib - ie - 1), symb, rad); // if (symb.ne.0 .and. ib.gt.2) call MX$DRAW_SYMBOLS(ic, pix(2), ib-2, symb, rad)
                                            }
                                            ie = ib;
                                        } else {
                                            // otherwise add it to the line to be drawn
                                            pixx[ib] = Math.round((x - xxmin) * xscl) + left;
                                            pixy[ib] = Math.round((y - yymin) * yscl) + top;
                                            ib += 1;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            wn = update_winding_number(wn, mid_x, mid_y, x, y, Mx.stk[Mx.level].xmax, Mx.stk[Mx.level].ymin);
            wn = update_winding_number(wn, mid_x, mid_y, Mx.stk[Mx.level].xmax, Mx.stk[Mx.level].ymin, Mx.stk[Mx.level].xmin, Mx.stk[Mx.level].ymin);
            if ((ib - ie) > 0) {
                mx.draw_lines(Mx, colors, pixx.subarray(ie, ib), pixy.subarray(ie, ib), (ib - ie), line, style);
                if (visible) {
                    ie = ie + 1;
                }
                if (symb !== 0 && (ib - ie) > 1) { mx.draw_symbols(Mx, color, pixx.subarray(ie, ib), pixy.subarray(ie, ib), (ib - 1), symb, rad); /* TODO is ib-1 correct here?? */ }
            }

            if (options.fillStyle) {
                if ((ib > 1) || (wn !== 0)) {
                    // if we have at least one point
                    // or the entire plot area is in the fill zone
                    mx.fill_trace(Mx, options.fillStyle, pixx, pixy, ib);
                }
            }
        }

        if (!options.noclip) {
            mx.clip(Mx, 0, 0, 0, 0);
        }
    };

    /**
     * Set dashed or solid lines mode.
     * @param Mx
     * @param linewidth
     * @param style
     */
    //
    // ~= MX$DRAW_MODE
    //
    mx.draw_mode = function(Mx, linewidth, style) {
        Mx.linewidth = (linewidth === undefined) ? 1 : linewidth;
        Mx.style = style;
    };

    /**
     * @param Mx
     * @param color
     * @param x1
     * @param y1
     * @param x2
     * @param y2
     * @param linewidth
     * @param style
     */
    //
    // ~= MX$DRAW_LINES
    //
    mx.draw_line = function(Mx, color, x1, y1, x2, y2, linewidth, style) {
        var ctx = Mx.active_canvas.getContext("2d");
        if (linewidth === undefined) {
            linewidth = Mx.linewidth;
        }
        if (style === undefined) {
            style = Mx.style;
        }
        // Look up the color in Mx.pixels
        if (typeof color === "number") {
            if (!Mx.pixel || Mx.pixel.length === 0) {
                m.log.warn("COLORMAP not initialized, defaulting to foreground");
                color = Mx.fg;
            } else {
                var cidx = Math.max(0, Math.min(Mx.pixel.length, color));
                color = to_rgb(
                    Mx.pixel[cidx].red,
                    Mx.pixel[cidx].green,
                    Mx.pixel[cidx].blue);
            }
        }
        draw_line(ctx, x1, y1, x2, y2, style, color, linewidth);
    };

    /**
     * @param Mx
     * @param x1
     * @param y1
     * @param x2
     * @param y2
     */
    //
    // ~= MX$RUBBERLINE
    //
    mx.rubberline = function(Mx, x1, y1, x2, y2) {
        var ctx = Mx.active_canvas.getContext("2d");
        draw_line(ctx, x1, y1, x2, y2, {
            mode: "xor"
        }, "white", 1);
    };

    /**
     * @param Mx
     * @param fillStyle
     * @param pixx
     * @param pixy
     * @param npts
     * @private
     */
    mx.fill_trace = function(Mx, fillStyle, pixx, pixy, npts) {
        var ctx = Mx.active_canvas.getContext("2d");
        if (Array.isArray(fillStyle)) {
            ctx.fillStyle = mx.linear_gradient(Mx, 0, 0, 0, Mx.b - Mx.t, fillStyle);
        } else {
            ctx.fillStyle = fillStyle;
        }

        if (npts < 1) {
            ctx.fillRect(Mx.l, Mx.t, (Mx.r - Mx.l), (Mx.b - Mx.t));
            return;
        }

        if (fillStyle) {
            var x = pixx[0];
            var y = pixy[0];

            ctx.beginPath();
            if (y === Mx.t) {
                ctx.lineTo(Mx.l, Mx.t);
            } else {
                ctx.lineTo(Mx.l, Mx.b);
            }


            ctx.lineTo(x, y);



            for (var i = 1; i < npts; i++) {
                x = pixx[i];
                y = pixy[i];
                ctx.lineTo(x, y);
            }

            if (y === Mx.t) {
                ctx.lineTo(Mx.r, Mx.t);
            }
            ctx.lineTo(Mx.r, Mx.b);
            if (pixy[0] === Mx.t) {
                ctx.lineTo(Mx.l, Mx.b);
            }

            ctx.closePath();
            ctx.fill();
        }
    };

    /**
     * @param Mx
     * @param colors
     * @param pixx
     * @param pixy
     * @param npts
     * @param linewidth
     * @param style
     */
    //
    // ~= MX$DRAW_LINES
    //
    mx.draw_lines = function(Mx, colors, pixx, pixy, npts, linewidth, style) {
        var ctx = Mx.active_canvas.getContext("2d");

        if (npts < 1) {
            return;
        }

        var x = pixx[0];
        var y = pixy[0];

        if (linewidth === undefined) {
            linewidth = Mx.linewidth;
        }
        if (style === undefined) {
            style = Mx.style;
        }

        if ((style) && (style.mode === "dashed")) {
            var dash_supported = dashOn(ctx, style.on, style.off);
            if (!dash_supported) {
                m.log.warn("WARNING: Dashed lines aren't supported on your browser");
            }
        }

        ctx.lineWidth = linewidth;
        var current_color = 0;

        if (typeof colors === "string") {
            colors = [{
                start: 0,
                color: colors
            }];
        } else if (!(colors instanceof Array)) {
            if (colors.start === undefined) {
                colors.start = 0;
            }
            colors = [colors];
        }

        for (var n = 0; n < colors.length; n++) {
            if ((colors[n].end != null) && (colors[n].end < x)) {
                colors.remove(n);
            } else if (colors[n].start < x) {
                current_color = n;
            }
        }

        ctx.strokeStyle = colors[current_color].color;
        ctx.beginPath();
        ctx.moveTo(x, y);

        for (var i = 0; i < npts; i++) {
	    if ((x === pixx[i]) && (y === pixy[i])) { continue; }
            x = pixx[i];
            y = pixy[i];

            var newcolor = false;
            if ((current_color > 0) && (colors[current_color].end != null) && (colors[current_color].end < x)) {
                newcolor = true;
                while ((colors[current_color].end != null) && (colors[current_color].end < x)) {
                    colors.remove(current_color);
                    current_color -= 1;
                    if (current_color === 0) {
                        break;
                    }
                }
            }

            if (((current_color + 1) < colors.length) && (colors[current_color + 1].start <= x)) {
                newcolor = true;
                while (((current_color + 1) < colors.length) && (colors[current_color + 1].start <= x)) {
                    current_color++;
                }
            }

            ctx.lineTo(x, y);
            if (newcolor) {
                ctx.stroke();
                ctx.strokeStyle = colors[current_color].color;
                ctx.beginPath();
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        dashOff(ctx);
        ctx.beginPath();
    };

    /**
     * @param Mx
     * @param left
     * @param top
     * @param width
     * @param height
     */
    //
    // ~= MX$CLIP
    //
    mx.clip = function(Mx, left, top, width, height) {
        var ctx = Mx.active_canvas.getContext("2d");

        if ((left === 0) && (top === 0) && (width === 0) && (height === 0)) {
            ctx.restore();
            return;
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
    };

    /**
     * @param Mx
     */
    //
    // ~= MX$CLEAR_WINDOW
    //
    mx.clear_window = function(Mx) {
        var ctx = Mx.active_canvas.getContext("2d");

        ctx.fillStyle = Mx.bg;
        ctx.fillRect(0, 0, Mx.width, Mx.height);
    };

    /**
     * @param Mx
     * @private
     */
    mx.erase_window = function(Mx) {
        var ctx = Mx.active_canvas.getContext("2d");

        ctx.clearRect(0, 0, Mx.width, Mx.height);
    };

    /**
     * @param Mx
     * @param func
     * @param mode
     * @param def_style
     * @param alt_style
     */
    //
    // ~= MX$RUBBERBOX
    // Unlike MX$RUBBERBOX, this is a non-blocking call.  As such the 'func' is a callback for then the rubberbox is finished.
    //
    // When CTRL is pressed, alt_style is used
    //
    mx.rubberbox = function(Mx, func, mode, def_style, alt_style) {
        mx.warpbox(Mx, Mx.xpos, Mx.ypos, Mx.xpos, Mx.ypos, 0, Mx.width, 0, Mx.width, func, mode, def_style, alt_style);
    };

    /**
     * @param Mx
     * @param xo
     * @param yo
     * @param xl
     * @param yl
     * @param xmin
     * @param xmax
     * @param ymin
     * @param ymax
     * @param func
     * @param mode
     * @param def_style
     * @param alt_style
     */
    //
    // ~= MX$WARPBOX
    // Unlike MX$WARPBOX, this is a non-blocking call.   As such the 'func' is a callback for then the rubberbox is finished.
    //
    mx.warpbox = function(Mx, xo, yo, xl, yl, xmin, xmax, ymin, ymax, func, mode, def_style, alt_style) {
        if (!def_style) {
            def_style = {};
        }

        Mx.warpbox = new WARPBOX();
        Mx.warpbox.xo = xo;
        Mx.warpbox.yo = yo;
        Mx.warpbox.xl = xl;
        Mx.warpbox.yl = yl;
        Mx.warpbox.xmin = xmin;
        Mx.warpbox.xmax = xmax;
        Mx.warpbox.ymin = ymin;
        Mx.warpbox.ymax = ymax;
        Mx.warpbox.func = func;
        Mx.warpbox.mode = mode;

        Mx.warpbox.style = def_style;
        Mx.warpbox.def_style = def_style;
        Mx.warpbox.alt_style = alt_style;
    };

    /**
     * @param inorigin
     * @param outorigin
     * @param instk
     */
    //
    // ~= M$ORIGIN
    //
    mx.origin = function(inorigin, outorigin, instk) {
        inorigin = Math.max(1, inorigin);
        outorigin = Math.max(1, outorigin);

        var outstk = new mx.STKSTRUCT();

        outstk.xmin = instk.xmin;
        outstk.xmax = instk.xmax;
        outstk.ymin = instk.ymin;
        outstk.ymax = instk.ymax;
        outstk.xscl = instk.xscl;
        outstk.yscl = instk.yscl;
        outstk.x1 = instk.x1;
        outstk.y1 = instk.y1;
        outstk.x2 = instk.x2;
        outstk.y2 = instk.y2;

        if (inorigin !== outorigin) {
            var diff = Math.abs(outorigin - inorigin); // used to simplify boolean logic
            var sum = outorigin + inorigin;
            if (diff === 2 || sum !== 5) { // (1<->3) (2<->4) (1<->2) (3<->4)
                outstk.xmin = instk.xmax;
                outstk.xmax = instk.xmin;
                outstk.xscl = -instk.xscl;
            }
            if (diff === 2 || sum === 5) { // (1<->3) (2<->4) (1<->4) (2<->3)
                outstk.ymin = instk.ymax;
                outstk.ymax = instk.ymin;
                outstk.yscl = -instk.yscl;
            }
        }
        return outstk;
    };

    /**
     * @param end1
     * @param end2
     */
    //
    // ~= MX$MULT
    //
    mx.mult = function(end1, end2) {
        var absmax = Math.max(Math.abs(end1), Math.abs(end2));
        if (absmax === 0) {
            return 1.0;
        }
        var kengr = 0.1447648 * Math.log(absmax);
        kengr = kengr | kengr; // Math.floor always rounds down, so -3.3 becomes -4 use this bitwise hack instead
        if (absmax < 1.0) {
            kengr = kengr - 1;
        }
        if (kengr < 0) {
            return 1.0 / Math.pow(10, (-3 * kengr));
        } else {
            return Math.pow(10, (3 * kengr));
        }
    };

    /**
     * @param Mx
     * @param event
     * @private
     */
    //
    // event may be undefined or null
    mx.widget_callback = function(Mx, event) {
        if (Mx.prompt) {
            if (event.which === 3) {
                Mx.prompt.input.onsubmit();
            }
        }

        if (Mx.widget) {
            Mx.widget.callback(event);
        }
    };

    /**
     * @param Mx
     * @param promptText
     * @param isValid
     * @param onSuccess
     * @param refresh
     * @param inputValue
     * @param xpos
     * @param ypos
     * @param errorTimeout
     */
    //
    // ~= MX$DPROMPT - only higher-level
    mx.prompt = function(Mx, promptText, isValid, onSuccess, refresh, inputValue, xpos, ypos, errorTimeout) {
        if (inputValue !== undefined) {
            var inputValid = isValid(inputValue);

            if (!inputValid.valid) {
                throw "Prompt default input value not valid due to '" + inputValid.reason + "'";
            }
        }

        // TODO Validation - make sure promptText is not too long and isn't multi-line...
        mx.onWidgetLayer(Mx, function() {
            var ctx = Mx.active_canvas.getContext("2d");
            var maxNumChars = 30;

            // Construct the input box
            var pxIndex = ctx.font.indexOf('px');
            var fontIndex = pxIndex + 3;
            var fontSize = ctx.font.substr(0, pxIndex);
            var fontFamily = ctx.font.substr(fontIndex, ctx.font.length).toString();

            /* TODO Note: There is a scrolling bug - you can scroll to the right, but not the left of the value
			And... when truncating the width of an input field - it shows the value as though truncated 
			from the right (say if its cut off by 1 and that one happened to be a negative sign, the value 
			would look like a positive) .
			 */
            var canvasInput = new CanvasInput({
                height: Mx.text_h,
                fontFamily: fontFamily,
		/* jshint -W053 */
                fontSize: new Number(fontSize),
		/* jshint +W053 */
                backgroundColor: Mx.bg,
                fontColor: Mx.fg,
                borderWidth: 0,
                borderRadius: 0,
                padding: 0,
                boxShadow: "none",
                innerShadow: "none",
                width: Mx.text_w * maxNumChars,
                value: (inputValue !== undefined ? inputValue.toString() : ""),
                disableBlur: true,
                renderOnReturn: false,
                tabToClear: true
            });

            var subHandlerCreator = function(messageX, messageY) {
                return function() {
                    var newValue = this.value();

                    var inputValid = isValid(newValue);

                    if (!inputValid.valid) {
                        mx.message(Mx, "Value: '" + newValue + "' isn't valid due to '" + inputValid.reason + "' - RETRY", undefined, messageX, messageY);

                        // Clear error message
                        setTimeout(function() {
                            mx.onWidgetLayer(Mx, function() {
                                mx.erase_window(Mx);
                            });
                            Mx.widget = null;
                            //refresh();
                        }, errorTimeout != null ? errorTimeout : 4000);
                    } else {
                        Mx.prompt = undefined; // clear state variable

                        // Kill CanvasInput
                        this.cleanup();
                        mx.onWidgetLayer(Mx, function() {
                            mx.erase_window(Mx);
                        });

                        onSuccess(newValue);
                    }
                };
            };

            // Create redraw method
            var redrawPromptCreator = function(Mx, input, promptText) {
                return function(xpos, ypos) {
                    mx.onWidgetLayer(Mx, function() {
                        var GBorder = 3;

                        // Calculate the position variables

                        var xssPrompt = (promptText.length + 2) * Mx.text_w;
                        var xss = xssPrompt + (maxNumChars + 1) * Mx.text_w;
                        var yss = 2 * Mx.text_h;

                        var xs = xss + 2 * GBorder;
                        var ys = yss + 2 * GBorder;
                        if (!xpos) {
                            xpos = Mx.xpos;
                        }
                        if (!ypos) {
                            ypos = Mx.ypos;
                        }
                        var xc = Math.max(0, Math.min(xpos, Mx.width - xs));
                        var yc = Math.max(0, Math.min(ypos, Mx.height - ys));
                        var xcc = xc + GBorder;
                        var ycc = yc + GBorder;

                        var yPos = ycc + Mx.text_h * 1.5;
                        var inputXPos = xcc + Mx.text_w;

                        // Draw the box and label text
                        mx.widgetbox(Mx, xc, yc, xs, ys, xcc, ycc, 0, "");
                        mx.text(Mx, inputXPos, yPos, promptText);

                        var inputYPos = yPos - Mx.text_h * 1.15;

                        // Redraw the input at the new location
                        input.x(xcc + Mx.text_w + xssPrompt - Mx.text_w);
                        input.y(inputYPos);

                        input.onsubmit(subHandlerCreator(xc, inputYPos - 75)); // TODO Refactor positioning based on char length of reason code...
                        if (!input.canvas()) {
                            input.canvas(Mx.active_canvas);
                        } else {
                            input.render();
                        }
                    });
                };
            };

            var redrawPrompt = redrawPromptCreator(Mx, canvasInput, promptText);

            //refresh();
            redrawPrompt(xpos, ypos);
            canvasInput.focus();

            // Set state variable
            Mx.prompt = {
                redraw: redrawPrompt,
                input: canvasInput
            };
        });
    };

    /**
     * Floating-point number validator. Verifies that value is a valid floating point
     * number. Validation is loose by default - meaning empty strings are considered valid.
     * @param value The value to validate.
     * @param strict If strict is set to true - does not consider empty strings as valid floating point numbers.
     * @private
     */
    mx.floatValidator = function(value, strict) {
        if (!(((strict === undefined || strict === false) && value === "")) &&
            isNaN(parseFloat(value)) || !isFinite(value)) {
            return {
                valid: false,
                reason: "Failed float validation: not a valid floating point number"
            };
        }

        return {
            valid: true,
            reason: ""
        };
    };

    /**
     * Integer number validator. Verifies that value is a valid integer.
     * Validation is loose by default - meaning empty strings are considered valid.
     * @param value The value to validate.
     * @param strict If strict is set to true - does not consider empty strings as valid integers.
     * @private
     */
    mx.intValidator = function(value, strict) {
        if (((strict === undefined || strict === false) && value === "") ||
            ((parseFloat(value) === parseInt(value, 10)) && !isNaN(value))) {
            return {
                valid: true,
                reason: ""
            };
        } else {
            return {
                valid: false,
                reason: "Failed integer validation: not a valid integer"
            };
        }
    };

    /**
     * @param Mx
     * @param msg
     * @param time
     * @param xpos
     * @param ypos
     */
    //
    // ~= MX$MESSAGE
    //
    mx.message = function(Mx, msg, time, xpos, ypos) {
        mx.onWidgetLayer(Mx, function() {
            var GBorder = 3;

            // Unlike MX$MESSAGE, this implementaion if the message
            // already contains newlines, the text will placed in the
            // box as-is.
            var beg = msg.split(/\r\n|\r|\n/g);
            var linel = 0;
            var center;
            if (beg.length === 1) {
                beg = [];
                var MESSWIDTH = 40;

                linel = Math.min((((Mx.width - 2 * GBorder) / Mx.text_w) - 2), msg.length);
                if (linel <= 0) { return; }
                while ((linel > MESSWIDTH) && (2.5 * Mx.text_h * msg.length < Mx.height * linel)) {
                    linel -= 5;
                }

                var cur = 0;
                var bg = 0;
                var i = 0;
                var j = 0;
                var end = 0;
                var brk = 0;
                var beg = [];

                center = true;
                while (bg < msg.length) {
                    end = bg + linel - 1;
                    brk = end = Math.min(end, msg.length - 1);
                    var endinreturn = false;
                    for (cur = bg; cur <= end && !endinreturn; cur++) {
                        switch (msg[cur]) {
                            case ',':
                            case ';':
                            case ' ':
                            case ':':
                                brk = cur;
                                break;
                            case '-':
                            case '/':
                                if (brk !== cur - 1) { brk = cur; }
                                break;
                            case '@':
                            case '\n':
                            case '\r':
                                center = false;
                                endinreturn = true;
                                brk = cur;
                                break;
                        }
                    }
                    if (cur === msg.length) { brk = end; }
                    if (endinreturn) {
                        beg.push(msg.substring(bg, brk));
                    } else {
                        // trim leading space
                        var s = msg.substring(bg, brk + 1).replace(/^\s+/, "");
                        beg.push(s);
                    }
                    bg = brk + 1;
                    j = Math.max(j, beg[i].length);
                }
            } else {
                for (var i = 0; i < beg.length; i++) {
                    linel = Math.min((((Mx.width - 2 * GBorder) / Mx.text_w) - 2), Math.max(linel, beg[i].length));
                }
            }

            var lines = beg.length;
            if (lines > 6) {
                center = false;
            }
            var cur = 0;
            var winlines = Math.max(1, Mx.height / Mx.text_h);
            var lastline = Math.min(lines, cur + winlines - 1);

            var xss = (linel + 2) * Mx.text_w;
            var yss = (lastline - cur + 1) * Mx.text_h;

            var xs = xss + 2 * GBorder;
            var ys = yss + 2 * GBorder;
            if (!xpos) {
                xpos = Mx.xpos;
            }
            if (!ypos) {
                ypos = Mx.ypos;
            }
            var xc = Math.max(0, Math.min(xpos, Mx.width - xs));
            var yc = Math.max(0, Math.min(ypos, Mx.height - ys));
            var xcc = xc + GBorder;
            var ycc = yc + GBorder;

            mx.widgetbox(Mx, xc, yc, xs, ys, xcc, ycc, 0, "");

            var j = ycc + Mx.text_h / 3;
            var i = xcc + Mx.text_w;
            while (cur < lastline) {
                j += Mx.text_h;
                if (center) {
                    i = xc + xs / 2 - ((beg[cur].length * Mx.text_w) / 2);
                }
                mx.text(Mx, i, j, beg[cur]);
                cur++;
            }

            Mx.widget = {
                type: "ONESHOT",
                callback: function(event) {
                    if ((event.type === "mousedown") || (event.type === "keydown")) {
                        Mx.widget = null;
                        mx.onWidgetLayer(Mx, function() {
                            mx.erase_window(Mx);
                        });
                    }
                }
            };
        });
    };

    /**
     * @param Mx
     * @param color
     * @param x
     * @param y
     * @param w
     * @param h
     * @param fill_opacity
     * @param fill_color
     */
    //
    // ~= MX$DRAW_BOX
    //
    mx.draw_box = function(Mx, color, x, y, w, h, fill_opacity, fill_color) {
        var ctx = Mx.active_canvas.getContext("2d");

        if (color !== "xor") {
            ctx.lineWidth = 1;
            ctx.strokeStyle = color;
            ctx.strokeRect(x, y, w, h);
        } else {
            if (typeof Uint8ClampedArray === 'undefined') {
                // we don't have typed arrays, so canvas getImageData operations
		// will be very slow, so use Mx.fg instead
		ctx.lineWidth = 1;
		ctx.strokeStyle = Mx.fg;
		ctx.strokeRect(x, y, w, h);
	    } else {
		// TODO switch to using TypedArrays
		x = Math.floor(x);
		y = Math.floor(y);
		w = Math.floor(w);
		h = Math.floor(h);

		// For now assume xor always uses the base canvas
		// even if it draws on another canvas
		var dctx = Mx.canvas.getContext("2d");

		var imgd = dctx.getImageData(x, y, w, 1);
		var pix = imgd.data;
		for (var c = 0; c < imgd.data.length; c++) {
		    pix[c * 4] = 255 - pix[c * 4]; // red
		    pix[c * 4 + 1] = 255 - pix[c * 4 + 1]; // green
		    pix[c * 4 + 2] = 255 - pix[c * 4 + 2]; // blue
		    pix[c * 4 + 3] = 255; // opacity
		}
		ctx.putImageData(imgd, x, y);

		imgd = dctx.getImageData(x, y + h, w, 1);
		pix = imgd.data;
		for (var c = 0; c < imgd.data.length; c++) {
		    pix[c * 4] = 255 - pix[c * 4]; // red
		    pix[c * 4 + 1] = 255 - pix[c * 4 + 1]; // green
		    pix[c * 4 + 2] = 255 - pix[c * 4 + 2]; // blue
		    pix[c * 4 + 3] = 255; // opacity
		}
		ctx.putImageData(imgd, x, y + h);

		var imgd = dctx.getImageData(x, y, 1, h);
		var pix = imgd.data;
		for (var c = 0; c < h; c++) {
		    pix[c * 4] = 255 - pix[c * 4]; // red
		    pix[c * 4 + 1] = 255 - pix[c * 4 + 1]; // green
		    pix[c * 4 + 2] = 255 - pix[c * 4 + 2]; // blue
		    pix[c * 4 + 3] = 255; // opacity
		}
		ctx.putImageData(imgd, x, y);

		imgd = dctx.getImageData(x + w, y, 1, h);
		pix = imgd.data;
		for (var c = 0; c < h; c++) {
		    pix[c * 4] = 255 - pix[c * 4]; // red
		    pix[c * 4 + 1] = 255 - pix[c * 4 + 1]; // green
		    pix[c * 4 + 2] = 255 - pix[c * 4 + 2]; // blue
		    pix[c * 4 + 3] = 255; // opacity
		}
		ctx.putImageData(imgd, x + w, y);
	    }
        }

        if ((fill_opacity !== undefined) && (fill_opacity > 0)) {
            var oldAlpha = ctx.globalAlpha;
            ctx.globalAlpha = fill_opacity;
            if (fill_color) {
                ctx.fillStyle = fill_color;
            } else {
                ctx.fillStyle = color;
            }
            ctx.fillRect(x + 1, y + 1, w - 1, h - 1);
            ctx.globalAlpha = oldAlpha;
        }
    };

    /**
     * @param Mx
     * @param width
     */
    // ~= MX$SETFONT
    mx.set_font = function(Mx, width) {
        var ctx = Mx.canvas.getContext("2d");
        var ctx_wid = Mx.wid_canvas.getContext("2d");

        if ((Mx.font) && (Mx.font.width === width)) {
            // use the cached font
            ctx.font = Mx.text_h + "px " + Mx.font.font;
            ctx_wid.font = Mx.text_h + "px " + Mx.font.font;
        } else {
            // figure out the font
            var font = "Courier New, monospace";
            var text_h = 1;
            do {
                text_h = text_h + 1;
                ctx.font = text_h + "px " + font;
                ctx_wid.font = text_h + "px " + font;
                var font_size = ctx.measureText('M'); // the capital M is typically the same height and width
                Mx.text_w = font_size.width;
                Mx.text_h = text_h;
            } while (Mx.text_w < width);
            Mx.font = {
                font: font,
                width: width
            };
        }
    };


    /**
     * @param Mx
     * @param xstart
     * @param ystart
     * @param xend
     * @param yend
     * @param style
     */
    // ~= MX$FTEXTLINE
    mx.textline = function(Mx, xstart, ystart, xend, yend, style) {
        var ctx = Mx.active_canvas.getContext("2d");
        if (!style) {
            style = {};
        }
        if (!style.color) {
            style.color = Mx.fg;
        }
        if (!style.width) {
            style.width = 1;
        }
        draw_line(ctx, xstart, ystart, xend, yend, style, style.color, style.width);
    };

    /**
     * @param dmin
     * @param dmax
     * @param ndiv
     */
    // ~= MX$TICS
    mx.tics = function(dmin, dmax, ndiv) {
        var dtic = 1;
        var dtic1 = dmin;

        // handle degenerate case
        if (dmax === dmin) {
            return {
                dtic: 1,
                dtic1: dmin
            };
        }

        // split up range into about ndiv 'nice' chunks
        // zero is included only if   dmin < zero < dmax
        var dran = Math.abs(dmax - dmin);
        var df = dran / ndiv;
        var sig = log10(Math.max(df, 1.0e-36));
        var nsig;
        if (sig < 0.0) {
            nsig = Math.ceil(sig);
            nsig = nsig - 1;
        } else {
            nsig = Math.floor(sig);
        }

        var ddf = df * Math.pow(10.0, (-nsig));
        sig = Math.pow(10.0, nsig);
        if (ddf < 1.75) {
            dtic = sig;
        } else if (ddf < 2.25) {
            dtic = 2.0 * sig;
        } else if (ddf < 3.5) {
            dtic = 2.50 * sig;
        } else if (ddf < 7.0) {
            dtic = 5.0 * sig;
        } else {
            dtic = 10.0 * sig;
        }

        // redefine dmin and dmax to line up on 'nice' boundaries
        if (dtic === 0.0) {
            dtic = 1.0;
        }
        var nseg;
        if (dmax >= dmin) {
            if (dmin >= 0.0) {
                nseg = dmin / dtic + 0.995;
            } else {
                nseg = dmin / dtic - 0.005;
            }
            nseg = Math.floor(nseg); // floor
            dtic1 = nseg * dtic;
        } else {
            if (dmin >= 0.0) {
                nseg = dmin / dtic + 0.005;
            } else {
                nseg = dmin / dtic - 0.995;
            }
            nseg = Math.floor(nseg); // floor
            dtic1 = nseg * dtic;
            dtic = -1 * dtic;
        }
        if (dtic1 + dtic === dtic1) {
            dtic = dmax - dmin;
        }

        return {
            dtic: dtic,
            dtic1: dtic1
        };
    };

    /**
     * @param Mx
     * @param xdiv
     * @param ydiv
     * @param xlab
     * @param ylab
     * @param flags
     */
    // ~= MX$FDRAWAXIS
    mx.drawaxis = function(Mx, xdiv, ydiv, xlab, ylab, flags) {
        var stk1 = mx.origin(Mx.origin, 1, Mx.stk[Mx.level]);
        var iscl = 0;
        var isct = 0;
        var iscr = 0;
        var iscb = 0;
        var width = 0;
        var height = 0;

        xlab = (xlab === undefined) ? 30 : xlab;
        ylab = (ylab === undefined) ? 30 : ylab;


        if (flags.exactbox) {
            iscl = Math.floor(stk1.x1);
            isct = Math.floor(stk1.y1);
            iscr = Math.floor(stk1.x2);
            iscb = Math.floor(stk1.y2);
            width = iscr - iscl;
            height = iscb - isct;
        } else {
            iscl = Math.max(Math.floor(stk1.x1) - 2, 0);
            isct = Math.max(Math.floor(stk1.y1) - 2, 0);
            iscr = Math.min(Math.floor(stk1.x2) + 2, Mx.width);
            iscb = Math.min(Math.floor(stk1.y2) + 2, Mx.height);
            width = iscr - iscl - 4;
            height = iscb - isct - 4;
        }

        var ctx = Mx.active_canvas.getContext("2d");
        if (flags.fillStyle) {
            if (Array.isArray(flags.fillStyle)) {
                ctx.fillStyle = mx.linear_gradient(Mx, 0, 0, 0, iscb - isct, flags.fillStyle);
            } else {
                ctx.fillStyle = flags.fillStyle;
            }
        } else {
            ctx.fillStyle = Mx.bg;
        }
        ctx.fillRect(iscl, isct, iscr - iscl, iscb - isct);

        if (!flags.noaxisbox) {
            mx.textline(Mx, iscl, isct, iscr, isct);
            mx.textline(Mx, iscr, isct, iscr, iscb);
            mx.textline(Mx, iscr, iscb, iscl, iscb);
            mx.textline(Mx, iscl, iscb, iscl, isct);
        }

        // form nice tickmarks
	var xtimecode;
        if (xlab === 1) { //time-based tics
            xtimecode = true;
        } else {
            xtimecode = false;
        }
        var ytimecode = false;


        var xTIC = {
            dtic: 0,
            dtic1: 0
        };
        var yTIC = {
            dtic: 0,
            dtic1: 0
        };

        if (xdiv < 0) {
            xTIC.dtic1 = stk1.xmin;
            xTIC.dtic = (stk1.xmin - stk1.xmax) / xdiv;
        } else if (xtimecode) {
            xTIC = mx.tics(stk1.xmin, stk1.xmax, xdiv);
        } else {
            xTIC = mx.tics(stk1.xmin, stk1.xmax, xdiv);
        }


        var xmult = 1.0;
        if (!xtimecode) {
            xmult = mx.mult(stk1.xmin, stk1.xmax);
        }
        if (ydiv < 0) {
            yTIC.dtic1 = stk1.ymin;
            yTIC.dtic = (stk1.ymin - stk1.ymax) / ydiv;
        } else if (ytimecode) {
            // TODO
        } else {
            yTIC = mx.tics(stk1.ymin, stk1.ymax, ydiv);
        }
        var ymult = 1.0;
        if (!ytimecode) {
            ymult = mx.mult(stk1.ymin, stk1.ymax);
        }

        var xticlabels = !flags.noxtlab;
        var yticlabels = !flags.noytlab;

        // add labels
        var ix = Math.max(0, iscl - 4 * Mx.text_w);
        var iy = 0;
        if (flags.ontop) {
            iy = Math.min(Mx.height, Math.floor(iscb + 1.5 * Mx.text_h));
        } else {
            iy = Math.max(Mx.text_h, Math.floor(isct - 0.5 * Mx.text_h));
        }

        var xlabel;
        var ylabel;

        if (iy > 0) {
            var ly = 0;
            if (!flags.noyplab) {
                ylabel = m.label(ylab, ymult);
            }
            if (!flags.noxplab) {
                xlabel = m.label(xlab, xmult);
            }
        }

        if (xlabel && ylabel) {
            mx.text(Mx, ix, iy, ylabel + " vs " + xlabel);
        } else if (xlabel) {
            mx.text(Mx, ix, iy, xlabel);
        } else if (ylabel) {
            mx.text(Mx, ix, iy, ylabel);
        }

        var itext = 5.5 * Mx.text_w;
        var jtext = 0;
        if (flags.ontop) {
            if (flags.inside) {
                jtext = isct + 1.0 * Mx.text_h;
            } else {
                jtext = isct - 0.2 * Mx.text_h;
            }
        } else {
            if (flags.inside) {
                jtext = iscb - 0.5 * Mx.text_h;
            } else {
                jtext = iscb + 1.0 * Mx.text_h + 2;
            }
        }
        var fact;
        if (stk1.xmin !== stk1.xmax) {
            fact = width / (stk1.xmax - stk1.xmin);
        } else {
            fact = width / 1.0;
        }

        var fmul;
        if (xmult !== 0) {
            fmul = 1.0 / xmult;
        } else {
            fmul = 1.0;
        }

        var sp;
        if (xticlabels) {
            if (xtimecode) {
                // TODO
                sp = (Math.abs(xTIC.dtic) / Math.max(Math.abs(xTIC.dtic1), Math.abs(xTIC.dtic)) > 1.0e-6);
            } else {
                sp = (Math.abs(xTIC.dtic) / Math.max(Math.abs(xTIC.dtic1), Math.abs(xTIC.dtic)) > 1.0e-6);
            }
        }
        if (xTIC.dtic === 0) {
            xTIC.dtic = stk1.xmax - xTIC.dtic1 + 1.0;
        }

        var i;
        var xlbl = "";
        for (var x = xTIC.dtic1; x <= stk1.xmax; x = x + xTIC.dtic) {
            i = iscl + Math.round(fact * (x - stk1.xmin)) + 2;
            if (i < iscl) {
                continue;
            }
            if (flags.grid && flags.grid !== "y") {
                if (!flags.gridStyle) {
                    flags.gridStyle = {
                        mode: "dashed",
                        on: 1,
                        off: 3
                    };
                }
                mx.textline(Mx, i, iscb, i, isct, flags.gridStyle);
            } else {
                mx.textline(Mx, i, iscb - 2, i, iscb + 2);
                mx.textline(Mx, i, isct - 2, i, isct + 2);
            }
            if (xticlabels) {
                if (sp) {
                    xlbl = "";
                    if (xtimecode) {
                        // TODO
                        xlbl = mx.format_f(x * fmul, 12, 6);
                    } else {
                        xlbl = mx.format_f(x * fmul, 12, 6);
                    }
                    xlbl = trimlabel(xlbl, true);
                    var itexti = Math.round(xlbl.length / 2) * Mx.text_w;
                    if (flags.inside) {
                        i = Math.max(iscl + itexti, i);
                        i = Math.min(iscr - itexti, i);
                    }
                    mx.text(Mx, i - itexti, jtext, xlbl);
                } else if (x === xTIC.dtic1) {
                    if (xtimecode) {
                        // TODO
                        xlbl = (xTIC.dtic1 * fmul).toString();
                        if (flags.inside) {
                            i = Math.floor(Math.max(iscl + itext, i));
                        }
                        mx.text(Mx, i - itext, jtext, xlbl);
                    } else {
                        xlbl = (xTIC.dtic1 * fmul).toString();
                        if (flags.inside) {
                            i = Math.floor(Math.max(iscl + itext, i));
                        }
                        mx.text(Mx, i - itext, jtext, xlbl);
                    }
                }
            }
        }

        // Add y-tick marks
        if (flags.yonright) {
            if (flags.inside) {
                itext = Math.min(iscr - 6 * Mx.text_w, Mx.width - 5 * Mx.text_w);
            } else {
                itext = Math.min(iscr + Mx.text_w, Mx.width - 5 * Mx.text_w);
            }
        } else {
            if (flags.inside) {
                itext = Math.max(0, iscl + Mx.text_w);
            } else {
                itext = Math.max(0, Math.floor(iscl - 5.5 * Mx.text_w));
            }
        }
        jtext = 0.4 * Mx.text_h;
        if (stk1.ymin !== stk1.ymax) {
            fact = -height / (stk1.ymax - stk1.ymin);
        } else {
            fact = -height / 1.0;
        }
        if (ymult !== 0) {
            fmul = 1.0 / ymult;
        } else {
            fmul = 1;
        }
        var ytic, ytic1, endtic;
        if (yTIC.dtic === 0) {
            ytic = stk1.ymax - ytic1 + 1.0;
        }
        if (stk1.ymax >= stk1.ymin) {
            endtic = function(val) {
                return (val <= stk1.ymax);
            };
        } else {
            endtic = function(val) {
                return (val >= stk1.ymax);
            };
        }
        for (var y = yTIC.dtic1; endtic(y); y = y + yTIC.dtic) {
            i = iscb + Math.round(fact * (y - stk1.ymin)) - 2;
            if (i > iscb) {
                continue;
            }
            if (flags.grid && flags.grid !== "x") {
                if (!flags.gridStyle) {
                    flags.gridStyle = {
                        mode: "dashed",
                        on: 1,
                        off: 3
                    };
                }
                mx.textline(Mx, iscl, i, iscr, i, flags.gridStyle);
            } else {
                mx.textline(Mx, iscl - 2, i, iscl + 2, i);
                mx.textline(Mx, iscr - 2, i, iscr + 2, i);
            }
            if (yticlabels) {
                // TODO
                if (flags.inside &&
                    ((i < isct + Mx.text_h) || (i > iscb - Mx.text_h * 2))) {
                    // out of range for inside labels
                } else if (ytimecode) {
                    // TODO
                } else {
                    var ylbl = mx.format_f(y * fmul, 12, 6);
                    ylbl = trimlabel(ylbl, flags.inside);
                    mx.text(Mx, itext, Math.min(iscb, i + jtext), ylbl);
                }
            }
        }
    };

    /**
     * @param x
     * @param y
     * @param rect_x
     * @param rect_y
     * @param rect_width
     * @param rect_height
     * @private
     */
    mx.inrect = function(x, y, rect_x, rect_y, rect_width, rect_height) {
        return (x >= rect_x && x <= rect_x + rect_width &&
            y >= rect_y && y <= rect_y + rect_height);
    };
    /**
     * @private
     */
    var MENU_CONSTANTS = {
        GBorder: 3,
        sidelab: 0,
        toplab: 1
    };

    /**
     * @method _menu_redraw
     * @param Mx
     * @param menu
     * @private
     */
    function _menu_redraw(Mx, menu) {
        if (menu.animationFrameHandle) { return; }

        menu.animationFrameHandle = requestAnimFrame(mx.withWidgetLayer(Mx, function() {
            mx.erase_window(Mx);

            menu.animationFrameHandle = undefined;
            var yb = Mx.text_h * 1.5;

            menu.x = Math.max(menu.x, 0);
            menu.y = Math.max(menu.y, 0);
            menu.x = Math.min(menu.x, Mx.width - menu.w);
            menu.y = Math.min(menu.y, Mx.height - menu.h);

            var xcc = menu.x + MENU_CONSTANTS.GBorder + Math.max(0, MENU_CONSTANTS.sidelab);
            var ycc = menu.y + MENU_CONSTANTS.GBorder + MENU_CONSTANTS.toplab * (yb + MENU_CONSTANTS.GBorder);

            var xss = menu.w - 2 * MENU_CONSTANTS.GBorder - Math.abs(MENU_CONSTANTS.sidelab);
            var yss = menu.h - 2 * MENU_CONSTANTS.GBorder - MENU_CONSTANTS.toplab * (yb + MENU_CONSTANTS.GBorder);

            mx.widgetbox(Mx, menu.x, menu.y, menu.w, menu.h, xcc, ycc, xss, yss, menu.title);

            //ctx.fillStyle = xwlo;
            //ctx.fillRect(xcc, ycc, xss, yss);

            var ctx = Mx.wid_canvas.getContext("2d");
            ctx.lineWidth = 1;

            ctx.strokeStyle = Mx.xwbs; // xwbs
            ctx.beginPath();
            ctx.moveTo(xcc, ycc - 4 + 0.5);
            ctx.lineTo(xcc + xss - 1, ycc - 4 + 0.5);
            ctx.stroke();

            ctx.strokeStyle = Mx.xwts; // xwts
            ctx.beginPath();
            ctx.moveTo(xcc, ycc - 3 + 0.5);
            ctx.lineTo(xcc + xss - 1, ycc - 3 + 0.5);
            ctx.stroke();

            for (var i = 0; i < menu.items.length; i++) {
                var item = menu.items[i];
                var y = ycc + yb * i;

                if (item.style === "separator") {
                    ctx.fillStyle = Mx.xwbs;
                    ctx.fillRect(xcc, y, xss, yb);

                    ctx.beginPath();
                    ctx.moveTo(xcc, y + 0.5);
                    ctx.lineTo(xcc + xss, y + 0.5);
                    ctx.stroke();

                    ctx.textBaseline = "middle";
                    ctx.textAlign = "left";
                    ctx.fillStyle = Mx.xwfg;
                    ctx.fillText(" " + item.text + " ", xcc + Mx.text_w * 2, y + yb / 2);
                } else {
                    ctx.fillStyle = Mx.xwlo;
                    ctx.fillRect(xcc, y, xss, yb);

                    ctx.beginPath();
                    ctx.moveTo(xcc, y + 0.5);
                    ctx.lineTo(xcc + xss, y + 0.5);
                    ctx.stroke();

                    if (item.selected) {
                        mx.shadowbox(Mx, xcc - 1, y, xss + 2, yb, 1, 2, "", 0);
                    }



                    ctx.textBaseline = "middle";
                    ctx.textAlign = "left";
                    ctx.fillStyle = Mx.xwfg;
                    if (item.style === "checkbox") {
                        ctx.fillText(" " + item.text + " ", xcc + Mx.text_w * 2, y + yb / 2);
                        ctx.strokeStyle = Mx.xwfg;
                        ctx.strokeRect(xcc + 1 + Mx.text_w, y + ((yb - Mx.text_w) / 2), Mx.text_w, Mx.text_w);
                        if (item.checked) {
                            ctx.beginPath();
                            ctx.moveTo(xcc + 1 + Mx.text_w, y + ((yb - Mx.text_w) / 2));
                            ctx.lineTo(xcc + 1 + Mx.text_w + Mx.text_w, y + ((yb - Mx.text_w) / 2) + Mx.text_w);
                            ctx.stroke();
                            ctx.beginPath();
                            ctx.moveTo(xcc + 1 + Mx.text_w + Mx.text_w, y + ((yb - Mx.text_w) / 2));
                            ctx.lineTo(xcc + 1 + Mx.text_w, y + ((yb - Mx.text_w) / 2) + Mx.text_w);
                            ctx.stroke();
                        }
                    } else {
                        ctx.fillText(" " + item.text + " ", xcc, y + yb / 2);

                        // draw the triangle
                        if (item.checked) {
                            ctx.beginPath();
                            ctx.moveTo(xcc + 1, y + Mx.text_h / 4);
                            ctx.lineTo(xcc + 1 + Mx.text_w - 2, y + Mx.text_h / 4 + Mx.text_h / 2);
                            ctx.lineTo(xcc + 1, y + Mx.text_h / 4 + Mx.text_h);
                            ctx.lineTo(xcc + 1, y + Mx.text_h / 4);
                            ctx.fill();
                        }
                    }
                }
            }
        }));
    }

    /**
     * @method _menu_takeaction
     * @param Mx
     * @param menu
     * @private
     */
    function _menu_takeaction(Mx, menu) {
        mx.onWidgetLayer(Mx, function() {
            mx.erase_window(Mx);
        });
        Mx.menu = undefined;
        Mx.widget = null;

        for (var i = 0; i < menu.items.length; i++) {
            var item = menu.items[i];
            if (item.selected) {
                if (item.handler) {
                    item.handler();
                } else if (item.menu) {
                    var newmenu = item.menu;
                    if (typeof item.menu === 'function') {
                        newmenu = item.menu();
                    }
                    newmenu.finalize = menu.finalize;
                    mx.menu(Mx, newmenu);
                }
                break;
            }
        }
        if ((!Mx.menu) && (menu.finalize)) {
            menu.finalize();
        }
    }

    /**
     * @method _menu_dismiss
     * @param Mx
     * @param menu
     * @private
     */
    function _menu_dismiss(Mx, menu) {
        mx.onWidgetLayer(Mx, function() {
            mx.erase_window(Mx);
        });
        Mx.menu = undefined;
        Mx.widget = null;

        if ((!Mx.menu) && (menu.finalize)) {
            menu.finalize();
        }
    }

    /**
     * @method _menu_callback
     * @param Mx
     * @param menu
     * @param event
     * @private
     */
    function _menu_callback(Mx, menu, event) {
        if (event === undefined) {
            // no event, just refresh the menu
            _menu_redraw(Mx, menu);
        } else if (event.type === "mousemove") {
            // Update position
            if (menu.drag_x !== undefined && menu.drag_y !== undefined && Math.abs(Mx.xpos - menu.drag_x) > 2 && Math.abs(Mx.ypos - menu.drag_y) > 2) {
                menu.x += Mx.xpos - menu.drag_x;
                menu.y += Mx.ypos - menu.drag_y;
                menu.drag_x = Mx.xpos;
                menu.drag_y = Mx.ypos;
            }

            // All of these variables suck and are common in other places...refactoring is necessary
            var xcc = menu.x + MENU_CONSTANTS.GBorder + Math.max(0, MENU_CONSTANTS.sidelab);
            var xss = menu.w - 2 * MENU_CONSTANTS.GBorder - Math.abs(MENU_CONSTANTS.sidelab);
            var yb = Mx.text_h * 1.5;
            var ycc = menu.y + MENU_CONSTANTS.GBorder + MENU_CONSTANTS.toplab * (yb + MENU_CONSTANTS.GBorder);

            for (var i = 0; i < menu.items.length; i++) {
                var y = ycc + yb * i;
                var item = menu.items[i];
                item.selected = false;
                if (mx.inrect(Mx.xpos, Mx.ypos, xcc, y, xss, yb)) {
                    item.selected = true;
                }
            }
            _menu_redraw(Mx, menu);
        } else if (event.type === "mouseup") {
            // No longer dragging menu
            menu.drag_x = undefined;
            menu.drag_y = undefined;
        } else if (event.type === "mousedown") {
            event.preventDefault();
            if (event.which === 1) {
                if (Mx.xpos > menu.x && Mx.xpos < (menu.x + menu.w) && Mx.ypos > menu.y && Mx.ypos < (menu.y + Mx.text_h * 1.5)) {
                    menu.drag_x = Mx.xpos;
                    menu.drag_y = Mx.ypos;
                } else {
                    _menu_takeaction(Mx, menu);
                }
            } else {
                _menu_dismiss(Mx, menu);
            }
        } else if (event.type === "keydown") {
            // Remember that keydown triggers periodically while a key is held
            if (Mx.menu) {
                var menu = Mx.menu;
                event.preventDefault();
                var keyCode = getKeyCode(event);
                if (keyCode === 13) { // enter
                    _menu_takeaction(Mx, menu);
                } else if (keyCode === 38) { // up arrow
                    for (var i = 0; i < menu.items.length; i++) {
                        var item = menu.items[i];
                        if (item.selected) {
                            item.selected = false;
                            if (menu.items[i - 1] !== undefined) {
                                menu.items[i - 1].selected = true;
                            }
                            break;
                        } else if (i === (menu.items.length - 1)) {
                            // we are at the end of the list and nothing was selected so pick the last element
                            item.selected = true;
                        }
                    }
                    _menu_redraw(Mx, menu);
                } else if (keyCode === 40) { // down arrow
                    for (var i = 0; i < menu.items.length; i++) {
                        var item = menu.items[i];
                        if (item.selected) {
                            item.selected = false;
                            if (menu.items[i + 1] !== undefined) {
                                menu.items[i + 1].selected = true;
                            }
                            break;
                        } else if (i === (menu.items.length - 1)) {
                            // nothing was selected so select the top
                            menu.items[0].selected = true;
                        }
                    }
                    _menu_redraw(Mx, menu);
                } else if ((keyCode >= 48 && keyCode <= 57) || (keyCode >= 65 && keyCode <= 90)) {
                    var inp = String.fromCharCode(keyCode).toUpperCase();

                    if (menu.keypresses === undefined) {
                        menu.keypresses = inp;
                    } else {
                        menu.keypresses = menu.keypresses + inp;
                    }

                    var matches = 0;
                    for (var i = 0; i < menu.items.length; i++) {
                        var item = menu.items[i];
                        item.selected = false;
                        if (!item.text) { continue; }

                        if (item.text.toUpperCase().indexOf(menu.keypresses) === 0) {
                            if (matches === 0) {
                                item.selected = true;
                            }
                            matches++;
                        }
                    }

                    if (matches === 0) {
                        menu.keypresses = undefined;
                        _menu_redraw(Mx, menu);
                    } else if (matches === 1) {
                        _menu_takeaction(Mx, menu);
                    } else {
                        _menu_redraw(Mx, menu);
                    }
                }
            }
        }
    }

    /**
     * @param Mx
     * @param menu
     * @private
     */
    mx.menu = function(Mx, menu) {
        var yb = Mx.text_h * 1.5;
        if (menu) {
            if (!Mx.widget) {
                menu.x = Mx.xpos;
                menu.y = Mx.ypos;
                menu.val = 0;

                menu.h = MENU_CONSTANTS.GBorder * 2 + yb * menu.items.length + MENU_CONSTANTS.toplab * (yb + MENU_CONSTANTS.GBorder) - 1;
                menu.y = menu.y - ((MENU_CONSTANTS.toplab + (Math.max(1, menu.val)) - 0.5) * yb + (1 + MENU_CONSTANTS.toplab) * MENU_CONSTANTS.GBorder) + 1;

                var xb = menu.title.length;
                var yadj = 0;
                for (var i = 0; i < menu.items.length; i++) {
                    var item = menu.items[i];
                    xb = Math.max(xb, item.text.length);
                    if (item.style === "checkbox") {
                        xb += 2;
                    }
                    if (item.style === "separator") {
                        xb += 2;
                    }
                    if (item.checked && item.style !== "checkbox") {
                        yadj = yb * i;
                    }
                }
                menu.y = menu.y - yadj;
                xb += 2;
                xb = xb * Mx.text_w;

                menu.w = MENU_CONSTANTS.GBorder * 2 + Math.abs(MENU_CONSTANTS.sidelab) + xb - 1;
                menu.x = menu.x - menu.w / 2;

                Mx.menu = menu;

                Mx.widget = {
                    type: "MENU",
                    callback: function(event) {
                        _menu_callback(Mx, menu, event);
                    }
                };
            }
            _menu_redraw(Mx, menu);
        }
    };

    /**
     * @param Mx
     * @param x
     * @param y
     * @param w
     * @param h
     * @param inx
     * @param iny
     * @param inw
     * @param inh
     * @param name
     * @private
     */
    mx.widgetbox = function(Mx, x, y, w, h, inx, iny, inw, inh, name) {
        var GBorder = 3;
        mx.shadowbox(Mx, x, y, w, h, 1, 2, "", 0);
        if (name) {
            var length = name.length;
            length = Math.min(length, w / Mx.text_w);
            length = Math.max(length, 1);
            var xt = x + (w - length * Mx.text_w) / 2;
            y += GBorder;
            var yt = y + (iny - y + 0.7 * Mx.text_h) / 2;

            mx.text(Mx, xt, yt, name, Mx.xwfg);
        }
        if (inw > 0 && inh > 0) {
            var ctx = Mx.active_canvas.getContext("2d");
            ctx.fillStyle = Mx.bg;
            ctx.fillRect(inx, iny, inw, inh);
        }
    };

    /**
     * @param Mx
     * @param x
     * @param y
     * @param lbl
     * @param color
     * @private
     */
    //
    // ~= MX$TEXT
    //
    mx.text = function(Mx, x, y, lbl, color) {
        var ctx = Mx.active_canvas.getContext("2d");

        x = Math.max(0, x);
        y = Math.max(0, y);
        if ((x < 0) || (y < 0)) {
            throw "On No!";
        }
        ctx.textBaseline = "bottom";
        ctx.textAlign = "left";
        if (color === undefined) {
            ctx.fillStyle = Mx.fg;
        } else {
            ctx.fillStyle = color;
        }

        ctx.fillText(lbl, x, y);
    };

    /**
     * @method clipt
     * @param denom
     * @param num
     * @param o
     * @private
     */
    // ~= glibf1.for CLIPT
    function clipt(denom, num, o) {
        var accept = true;
        var t;

        t = num / denom;
        if (denom > 0) {
            if (t > o.tL) {
                accept = false;
            } else if (t > o.tE) {
                o.tE = t;
            }
        } else if (denom < 0) {
            if (t < o.tE) {
                accept = false;
            } else if (t < o.tL) {
                o.tL = t;
            }
        } else {
            if (num > 0) {
                accept = false;
            }
        }

        return accept;
    }

    /**
     * Method which draws a line in a graphics context.
     * In the graphics context provided, draws a line.
     * Mimics XLib's XDrawLines method in at least the basic functionality.
     * @method draw_line
     * @param ctx
     * @param x1
     * @param y1
     * @param x2
     * @param y2
     * @param style
     * @param color
     * @param width
     * @private
     */
    function draw_line(ctx, x1, y1, x2, y2, style, color, width) {
        // For odd width lines (i.e. 1,3,5...) if you draw right
        // on the pixel boundry the canvas will actually draw a slightly
        // grey line 2 px wide.  You have to add .5 to get what you want.

        // Handle boundary cases - instead of throwing an exception, just bound
        // the value to 0
        if (x1 < 0) {
            x1 = 0;
        }
        if (y1 < 0) {
            y1 = 0;
        }
        if (x2 < 0) {
            x2 = 0;
        }
        if (y2 < 0) {
            y2 = 0;
        }

        if (width) {
            ctx.lineWidth = width;
        }
        if (color) {
            ctx.strokeStyle = color;
        }

        if (ctx.lineWidth % 2 === 1) {
            if (x1 === x2) {
                x1 = Math.floor(x1) + 0.5;
                x2 = x1;
            }
            if (y1 === y2) {
                y1 = Math.floor(y1) + 0.5;
                y2 = y1;
            }
        }

        if (!style || !style.mode) {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.beginPath();
        } else if (style.mode === "dashed") {
            var dash_supported = dashOn(ctx, style.on, style.off);
            if (dash_supported) {
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
                dashOff(ctx);
                ctx.beginPath();
            } else {
                // Fallback that only supports vertical/horizontal
                ctx.beginPath();
                if (y1 === y2) {
                    var x = Math.min(x1, x2);
                    x2 = Math.max(x1, x2);
                    while (x < x2) {
                        ctx.moveTo(x, y1);
                        ctx.lineTo(x + style.on, y1);
                        ctx.stroke();
                        x += (style.on + style.off);
                    }
                } else if (x1 === x2) {
                    // vertical line
                    var y = Math.min(y1, y2);
                    y2 = Math.max(y1, y2);
                    while (y < y2) {
                        ctx.moveTo(x1, y);
                        ctx.lineTo(x1, y + style.on);
                        ctx.stroke();
                        y += (style.on + style.off);
                    }
                } else {
                    throw "Only horizontal or vertical dashed lines are supported";
                }
                ctx.beginPath();
            }
        } else if (style.mode === "xor") {
            if (typeof Uint8ClampedArray === 'undefined') {
                // we don't have typed arrays, so canvas getImageData operations
		// will be very slow, so use color instead
		ctx.beginPath();
		ctx.moveTo(x1, y1);
		ctx.lineTo(x2, y2);
		ctx.stroke();
		ctx.beginPath();
	    } else {
		// currently xor-style is only supported for horizontal or vertical lines
		var w = 0;
		var h = 0;
		if (y1 === y2) {
		    w = Math.abs(x2 - x1);
		    h = width;
		    x1 = Math.min(x1, x2);
		} else if (x1 === x2) {
		    w = width;
		    h = Math.abs(y2 - y1);
		    y1 = Math.min(y1, y2);
		} else {
		    throw "Only horizontal and vertical lines can be drawn with XOR";
		}

		if ((w === 0) || (h === 0)) {
		    return;
		}

		x1 = Math.floor(x1);
		y1 = Math.floor(y1);
		var imgd = ctx.getImageData(x1, y1, w, h);
		var pix = imgd.data;
		// Loop over each pixel and invert the color.
		for (var i = 0, n = pix.length; i < n; i += 4) {
		    pix[i] = 255 - pix[i]; // red
		    pix[i + 1] = 255 - pix[i + 1]; // green
		    pix[i + 2] = 255 - pix[i + 2]; // blue
		    pix[i + 3] = 255; // opacity
		}
		ctx.putImageData(imgd, x1, y1);
		ctx.clearRect(0, 0, 1, 1);
	    }
        }
    }

    /**
     * Method which draws a polygon in a graphics context.
     * In the graphics context provided, draws a polygon.
     * Mimics XLib's XDrawLines method in at least the basic functionality.
     * @method draw_poly
     * @param ctx - The graphics context to draw in
     * @param pix - Defined as [\{"x": xval, y: "y": yval\}, \{"x": xval, "y":yval\}...].
     *              xval and yval represent their respective coordinate values in the tuples
     *				number of points in the structure can be retrieved via pix.length.
     * @param color - The color of the rectangle
     * @param width - The line width to set.
     * @private
     */
    function draw_poly(ctx, pix, color, width) { // TODO Should this be a public method?
        start_poly(ctx, pix, width);

        if (color) {
            ctx.strokeStyle = color;
        }

        ctx.stroke(); // draw the shape outlined in the path
        ctx.closePath();
    }

    /**
     * Method which draws a filled polygon in a graphics context.
     * In the graphics context provided draws a polygon, then fills it.
     * Mimics XLib's XFillPolygon method in at least the basic functionality.
     * Some differences between this and Xlib's method are:
     *  -no way to specify convex/non-convex
     *  -no way to specify CoordModeOrigin
     *  -no need to specify the number of points to draw (plots all points in pix)
     * @method fill_poly
     * @param ctx - The graphics context to draw in
     * @param pix - Defined as [\{"x": xval, y: "y": yval\}, \{"x": xval, "y":yval\}...].
     *              xval and yval represent their respective coordinate values in the tuples
     *				number of points in the structure can be retrieved via pix.length.
     * @param lineColor - The line color of the polygon
     * @param fillColor - The fill color of the polygon
     * @param lineWidth - The line width to set
     * @private
     */
    function fill_poly(ctx, pix, lineColor, fillColor, width) { // TODO Should this be a public method?
        start_poly(ctx, pix, width);

        if (lineColor) {
            ctx.strokeStyle = lineColor;
        }
        if (fillColor) {
            ctx.fillStyle = fillColor;
        }

        ctx.fill(); // fill in the shape only, no outline drawn
        ctx.closePath();
    }

    /**
     * Helper method which starts drawing a polygon in a graphics context.
     * In the graphics context provided, begins a path at the first point in pix,
     * then draws lines from each point in pix to the next. It also sets the width
     * of the line.
     * @method start_poly
     * @param ctx - The graphics context to draw in
     * @param pix - Defined as [\{"x": xval, y: "y": yval\}, \{"x": xval, "y":yval\}...].
     *              xval and yval represent their respective coordinate values in the tuples
     *				number of points in the structure can be retrieved via pix.length.
     * @param width - The line width to set.
     * @private
     */
    function start_poly(ctx, pix, width) {
        if (pix.length < 1) {
            return;
        }

        var x = pix[0].x;
        var y = pix[0].y;

        if (width) {
            ctx.lineWidth = width;
        } else {
            ctx.lineWidth = 1; // Default
        }

        ctx.beginPath();
        ctx.moveTo(x, y);

        for (var i = 0; i < pix.length; i++) {
            x = pix[i].x;
            y = pix[i].y;
            ctx.lineTo(x, y);
        }
    }

    /**
     * Method which draws a rectangle (hollowed) in a graphics context.
     * In the graphics context provided, draws a hollow rectangle.
     * Mimics XLib's XDrawRectangle method in at least the basic functionality.
     * @method draw_rectangle
     * @param ctx - The graphics context to draw in
     * @param x - The x coordinate
     * @param y - The y coordinate
     * @param width - The width of the rectangle
     * @param height - The height of the rectangle
     * @param color - The color of the rectangle
     * @param lineWidth - The line width to set.
     * @private
     */
    function draw_rectangle(ctx, x, y, width, height, color, lineWidth) { // TODO Should this be a public method?
        if (lineWidth) {
            ctx.lineWidth = lineWidth;
        }
        if (color) {
            ctx.strokeStyle = color;
        }

        ctx.strokeRect(x, y, width, height);
    }

    /**
     * Method which draws a rectangle (filled) in a graphics context.
     * In the graphics context provided, draws a filled rectangle.
     * Mimics XLib's XFillRectangle method in at least the basic functionality.
     * @method fill_rectangle
     * @param ctx - The graphics context to draw in
     * @param x - The x coordinate
     * @param y - The y coordinate
     * @param width - The width of the rectangle
     * @param height - The height of the rectangle
     * @param fillColor - The fill color of the rectangle
     * @param strokeColor - The line color of the rectangle
     * @param lineWidth - The line width to set.
     * @private
     */
    function fill_rectangle(ctx, x, y, width, height, fillColor, strokeColor, lineWidth) { // TODO Should this be a public method?
        if (lineWidth) {
            ctx.lineWidth = lineWidth;
        }
        if (strokeColor) {
            ctx.strokeStyle = strokeColor;
        }
        if (fillColor) {
            ctx.fillStyle = fillColor;
        }

        ctx.fillRect(x, y, width, height);
    }

    /**
     * @method pc2px
     * @param perc
     * @private
     */
    function pc2px(perc) {
        return Math.floor(Math.round(255 * (perc / 100)));
    }

    /**
     * @method to_rgb
     * @param red
     * @param green
     * @param blue
     * @private
     */
    function to_rgb(red, green, blue) {
        return "rgb(" + Math.round(red) + ", " + Math.round(green) + ", " + Math.round(blue) + ")";
    }

    /**
     *
     * Instead of dealing with color tables and stuff, all we really need
     * is the ability to on-the-fly generate a color from the map
     * @param Mx
     * @param map
     * @param z
     * @private
     */
    mx.getcolor = function(Mx, map, z) {
        var iz = 0;
        for (; iz < 6 && map[iz + 1].pos === 0; iz++) {}

        while (z > map[iz].pos && iz < 6) {
            iz++;
        }
        if ((iz === 0) || (z >= map[iz].pos)) {
            // above, below, or directly on boundry
            return to_rgb(
                pc2px(map[iz].red),
                pc2px(map[iz].green),
                pc2px(map[iz].blue));
        } else {
            // interpolation my dear watson
            var pf = (z - map[iz - 1].pos) / (map[iz].pos - map[iz - 1].pos);
            var zf = pc2px(pf * 100);
            var zf1 = 255 - zf;
            return to_rgb(
                (zf * (map[iz].red / 100) + zf1 * (map[iz - 1].red / 100)), (zf * (map[iz].green / 100) + zf1 * (map[iz - 1].green / 100)), (zf * (map[iz].blue / 100) + zf1 * (map[iz - 1].blue / 100)));
        }
    };

    /**
     * @method trimlabel
     * @param lbl
     * @param inside
     * @private
     */
    // ~= glibf1.for TRIMLABEL
    function trimlabel(lbl, inside) {
        var k;
        var j;
        if (lbl.substring(5, 8) === ".000000") { // this line seems to always evaluate to false
            k = 4;
        } else {
            k = lbl.length - 1;
            while (lbl[k] === "0") {
                k = k - 1;
            }
        }
        j = 0;
        while ((lbl[j] === " ") && ((k - j + 1 > 5) || inside)) {
            j = j + 1;
        }
        var res = lbl.substring(j, k + 1);
        if (res.indexOf(".") === -1) {
            res += ".";
        }
        return res;
    }

    /**
     * @param Mx
     * @private
     */
    mx.redraw_warpbox = function(Mx) {
        if (Mx.warpbox) {
            if (Mx._animationFrameHandle) {
                cancelAnimFrame(Mx._animationFrameHandle);
            }
            Mx._animationFrameHandle = requestAnimFrame(function() {
                display_warpbox(Mx);
            });
        }
    };

    /**
     * @method display_warpbox
     * @param Mx
     * @private
     */
    function display_warpbox(Mx) {
        Mx._animationFrameHandle = undefined;
        var warpbox = Mx.warpbox;
        var ctx = Mx.active_canvas.getContext("2d");

        if (!warpbox) {
            return;
        }

        if (((Mx.xpos >= warpbox.xmin) && (Mx.xpos <= warpbox.xmax)) &&
            ((Mx.ypos >= warpbox.ymin) && (Mx.ypos <= warpbox.ymax))) {

            // Update the position
            warpbox.xl = Mx.xpos;
            warpbox.yl = Mx.ypos;

            // Draw the current box
            var x = Math.min(warpbox.xo, warpbox.xl);
            var y = Math.min(warpbox.yo, warpbox.yl);
            var w = Math.abs(warpbox.xl - warpbox.xo);
            var h = Math.abs(warpbox.yl - warpbox.yo);

            if ((w === 0) || (h === 0)) {
                // Nothing to draw
                return;
            }

            if (warpbox.mode === "vertical") {
                x = Mx.l;
                w = Mx.r - Mx.l;
            } else if (warpbox.mode === "horizontal") {
                y = Mx.t;
                h = Mx.b - Mx.t;
            } // else box

            mx.onWidgetLayer(Mx, function() {
                mx.erase_window(Mx);
                mx.draw_box(Mx, "xor", x, y, w, h, warpbox.style.opacity, warpbox.style.fill_color);
            });
        }

    }

    /**
     * @method log10
     * @param val
     * @private
     */
    function log10(val) {
        return Math.log(val) / Math.log(10);
    }


    /**
     * Attempts to format a number in the same manner
     * as the FORTRAN format code 1p1g16.9
     * 1p1g16.9
     * 16 character fields
     * 9 for decimals
     * 3 for exponent (E)
     * 1 for sign
     * 1 for starting 0
     * 1 for decimal point
     * 1 for blank space
     *
     * The E format code is used for scientific (exponential) notation.
     * The value is rounded to d decimal positions and right-justified
     * into an external field that is w characters wide. The value of w
     * must be large enough to include a minus sign when necessary, at least
     * one digit to the left of the decimal point, the decimal point,
     * d digits to the right of the decimal point, a plus or minus sign for
     * the exponent, the character "e" or "E", and at least two characters for the exponent.
     *
     * The G format code uses the F output style when reasonable and
     * E for other values, but displays exactly d significant digits
     * rather than d digits following the decimal point.
     *
     * @param num
     * @param w
     * @param d
     * @param leading_nonzer
     * @private
     */
    mx.format_g = function(num, w, d, leading_nonzero) {
        var f = Math.abs(num).toString();

        var decloc = f.indexOf(".");
        // If there is no decimal point, add one at the end.
        if (decloc === -1) {
            f = f + ".";
            decloc = f.length;
        }

        var exp = 0;
        var eloc = f.indexOf("e");
        // If there is already an 'e' in the string parse it out
        if (eloc !== -1) {
            exp = parseInt(f.slice(eloc + 1, f.length), 10);
            f = f.slice(0, eloc);
        }

        // Add zero's to the end if necessary
        var dz = Math.min(d - (f.length - decloc) + 1, d);
        for (var i = 0; i < dz; i++) {
            f = f + "0";
        }

        if (num !== 0) {
            if (Math.abs(num) < 1.0) {
                if (f.slice(0, 2) === "0.") {
                    // Shift to the left until the first number is non-zero
                    for (var i = 2; i < f.length; i++) {
                        if (f[i] === "0") {
                            exp -= 1;
                        } else {
                            f = "0." + f.slice(i, i + d);
                            break;
                        }
                    }
                } else {
                    f = f.slice(0, d + 2);
                }
            } else if (decloc > d) {
                var exp = Math.max(0, f.length - d - 2);
                f = f[0] + "." + f.slice(1, 9);
            } else {
                f = f.slice(0, d + 2);
            }
        }

        if (exp === 0) {
            f = f + "    ";
        } else {
            var e = mx.pad(Math.abs(exp).toString(), 2, "0");
            if (exp < 0) {
                f = f + "E-" + e;
            } else {
                f = f + "E+" + e;
            }
        }

        if (num < 0) {
            f = "-" + f;
        } else {
            f = " " + f;
        }
        return f;
    };

    /**
     *
     * Behave like fortran format code
     * fs.d
     * @param num
     * @param s
     * @param d
     * @private
     */
    mx.format_f = function(num, s, d) {
        var f = num.toFixed(d).toString();
        f = mx.pad(f, (s + d), " ");
        return f;
    };

    /**
     * @param s
     * @param size
     * @param c
     * @private
     */
    mx.pad = function(s, size, c) {
        while (s.length < size) {
            s = c + s;
        }
        return s;
    };

    /**
     * @param Mx
     * @param x
     * @param y
     * @param w
     * @param h
     * @param shape
     * @param func
     * @param label
     * @private
     */
    // ~= MX$SHADOWBOX
    mx.shadowbox = function(Mx, x, y, w, h, shape, func, label) {
        var length = label.length; // Original method declaration includes a length - but it only represents the length of the label

        var xt = 0; // Originally an int
        var yt = 0; // Originally an int
        var bw = 0; // Originally an int

        var pix = []; // Originally declared as a size 11 XPoint array
        for (var cnt = 0; cnt < 11; cnt++) { // initializing 11 points in the array
            pix[cnt] = {
                x: 0,
                y: 0
            };
        }

        var fill = !(func === 1 || func === -1); // Originally a bool

        // Removed the G.BW section - since we don't need to support black & white displays

        var j = (shape === mx.L_ArrowLeft || shape === mx.L_ArrowUp) ? 1 : 2;

        if (func !== 0 && mx.GBorder > 0) {
            bw = m.trunc(Math.min(w, h) / 3);
            bw = Math.max(1, Math.min(bw, mx.GBorder));
        }

        if (bw > 0) {
            /* outer shape */
            pix[0].x = pix[1].x = x;
            pix[8].x = pix[9].x = x + w;
            pix[1].y = pix[8].y = y;
            pix[0].y = pix[9].y = y + h;

            switch (shape) {
                case mx.L_ArrowLeft:
                    pix[0].y = pix[1].y = y + m.trunc(h / 2);
                    x += 2;
                    --w;
                    break;
                case mx.L_ArrowRight:
                    pix[8].y = pix[9].y = y + m.trunc(h / 2);
                    --x;
                    --w;
                    break;
                case mx.L_ArrowUp:
                    pix[1].x = pix[8].x = x + m.trunc(w / 2);
                    y += 2;
                    --h;
                    break;
                case mx.L_ArrowDown:
                    pix[0].x = pix[9].x = x + m.trunc(w / 2);
                    --y;
                    --h;
                    break;
            }
            pix[2] = pix[8];
            pix[10] = pix[0];

            x += bw;
            y += bw;
            w -= 2 * bw;
            h -= 2 * bw;
        }

        /* inner shape */
        pix[4].x = pix[5].x = x;
        pix[3].x = pix[6].x = x + w;
        pix[3].y = pix[4].y = y;
        pix[5].y = pix[6].y = y + h;
        switch (shape) {
            case mx.L_ArrowLeft:
                pix[4].y = pix[5].y = y + m.trunc(h / 2);
                break;
            case mx.L_ArrowRight:
                pix[3].y = pix[6].y = y + m.trunc(h / 2);
                break;
            case mx.L_ArrowUp:
                pix[3].x = pix[4].x = x + m.trunc(w / 2);
                break;
            case mx.L_ArrowDown:
                pix[5].x = pix[6].x = x + m.trunc(w / 2);
                break;
        }
        pix[7] = pix[3];

        var ctx = Mx.active_canvas.getContext("2d");

        if (bw > 0) {
            ctx.fillStyle = (func > 0) ? Mx.xwts : Mx.xwbs; // Set foreground color
            fill_poly(ctx, pix.slice(0, 7));
            //	if (shape !== 1) { draw_poly(ctx, pix.slice(0,7)); } // TODO what shape is this neccessary with - causes an issue with arrows

            ctx.fillStyle = (func < 0) ? Mx.xwts : Mx.xwbs; // Set foreground color
            fill_poly(ctx, pix.slice(5, 11));
            //if (shape !== 1) { draw_poly(ctx, pix.slice(5, 11)); } // TODO what shape is this neccessary with - causes an issue with arrows
        }

        if (fill) {
            ctx.fillStyle = Mx.xwbg; // Set foreground color
            fill_poly(ctx, pix.slice(3, 8));
            //if (shape !== 1) { draw_poly(ctx, pix.slice(3, 8)); } // TODO what shape is this neccessary with - causes an issue with arrows
        }

        ctx.fillStyle = Mx.xwfg; // Set foreground color
        ctx.textBaseline = "alphabetic"; // Reset vertical text alignment

        if (fill && length > 0) {
            length = Math.min(length, m.trunc(w / Mx.text_w));
            length = Math.max(length, 1);
            xt = x + m.trunc((w - length * Mx.text_w) / 2);
            yt = y + m.trunc((h + 0.7 * Mx.text_h) / 2);
            ctx.fillText(label, xt, yt); // Draw a string
        }
    };

    /**
     * @param Mx
     * @param mouseEvent
     * @private
     */
    // ~= mx_ifevent
    mx.ifevent = function(Mx, mouseEvent) {
        Mx.button_press = 0;
        Mx.button_release = 0;
        Mx.state_mask = 0;

        var rect = mouseEvent.target.getBoundingClientRect();
        var eventXPos = (mouseEvent.offsetX === undefined) ? (mouseEvent.pageX - rect.left - window.scrollX) : mouseEvent.offsetX;
        var eventYPos = (mouseEvent.offsetX === undefined) ? (mouseEvent.pageY - rect.top - window.scrollY) : mouseEvent.offsetY;

        //		var eventXPos = (mouseEvent.offsetX === undefined) ? mouseEvent.layerX : mouseEvent.offsetX;
        //		var eventYPos = (mouseEvent.offsetY === undefined) ? mouseEvent.layerY : mouseEvent.offsetY;

        switch (mouseEvent.type) {
            case "mousedown":
                Mx.xpos = bound(eventXPos, 0, Mx.width);
                Mx.ypos = bound(eventYPos, 0, Mx.height);
                switch (mouseEvent.which) {
                    case 1:
                        Mx.button_press = 1;
                        break;
                    case 2:
                        Mx.button_press = 2;
                        break;
                    case 3:
                        Mx.button_press = 3;
                        break;
                    case 4:
                        Mx.button_press = 4;
                        break;
                    case 5:
                        Mx.button_press = 5;
                }
                //Mx.state_mask = TODO
                break;
            case "mouseup":
                Mx.xpos = bound(eventXPos, 0, Mx.width);
                Mx.ypos = bound(eventYPos, 0, Mx.height);
                switch (mouseEvent.which) {
                    case 1:
                        Mx.button_release = 1;
                        break;
                    case 2:
                        Mx.button_release = 2;
                        break;
                    case 3:
                        Mx.button_release = 3;
                        break;
                    case 4:
                        Mx.button_release = 4;
                        break;
                    case 5:
                        Mx.button_release = 5;
                }
                //Mx.state_mask = TODO
                break;
        }
    };

    /**
     * @param sv
     * @private
     */
    //
    // ~= scroll_real2pix
    //
    // TODO Refactor real2pix to return an object instead of sending in reference vars?
    mx.scroll_real2pix = function(sv) {
        // Param types:
        // sv - mx.SCROLLBAR

        if (sv.range === 0.0) {
            return {
                s1: sv.a1,
                sw: sv.a2 - sv.a1
            };
            //			out.s1 = sv.a1;
            //			out.sw = sv.a2 - sv.a1;
        } else {
            var dv; // real_8
            var ts1; // int_2
            var ts2; // int_2

            dv = (sv.a2 - sv.a1) / sv.trange;

            ts1 = sv.a1 + Math.floor(0.5 + (sv.smin - sv.tmin) * dv);
            ts2 = ts1 + Math.floor(0.5 + sv.srange * dv);

            if (ts1 > sv.a2 - sv.swmin) { ts1 = sv.a2 - sv.swmin; }
            else { ts1 = Math.max(ts1, sv.a1); }

            if (ts2 < sv.a1 + sv.swmin) { ts2 = sv.a1 + sv.swmin; }
            else { ts2 = Math.min(ts2, sv.a2); }

            return {
                s1: ts1,
                sw: Math.max(ts2 - ts1, sv.swmin)
            };
            //			out.s1 = ts1;
            //			out.sw = Math.max(ts2 - ts1, sv.swmin);
        }
    };

    /**
     * Method to re-draw a scrollbar after update. Logic taken from mx.scroll's UPDATE section.
     * @param sv The scrollbar to work with.
     * @param Mx The Mx context to work with.
     * @param op Optional op-code for XW_DRAW
     * @private
     */
    mx.redrawScrollbar = function(sv, Mx, op) {
        var x;
        var y;
        var xcc;
        var ycc;
        var xss;
        var yss;
        var p1;
        var op1; // int
        var s1;
        var sw; // int_2

        var ctx = Mx.active_canvas.getContext("2d");

        var scrollReal2PixOut = mx.scroll_real2pix(sv);
        s1 = scrollReal2PixOut.s1;
        sw = scrollReal2PixOut.sw;

        p1 = s1;
        op1 = sv.s1;

        xcc = sv.x;
        ycc = sv.y;
        xss = sv.w;
        yss = sv.h;

        if (sv.origin & 1) {
            y = ycc + yss / 2;
            if (sv.origin & 2) {
                op1 = xss - op1 - sv.sw;
                p1 = xss - p1 - sw;
            }
            if (op === mx.XW_DRAW) {
                var arrow = sv.arrow; // int

                mx.shadowbox(Mx, xcc, ycc, arrow, yss - 1, mx.L_ArrowLeft, 2, "", 0);
                mx.shadowbox(Mx, xcc + xss - arrow, ycc, arrow - 1, yss, mx.L_ArrowRight, 2, "", 0);
            }


            if (Mx.legacyRender) {
                mx.draw_line(Mx, Mx.fg, xcc + sv.a1, y, xcc + sv.a2, y);
                mx.shadowbox(Mx, xcc + p1, ycc, sw + 1, yss, 1, 2, "", 0);
            } else {
                var lingrad = ctx.createLinearGradient(xcc + sv.a1, 0, xcc + sv.a2, 0);
                lingrad.addColorStop(0, Mx.xwbs);
                lingrad.addColorStop(0.5, Mx.xwts);
                lingrad.addColorStop(1, Mx.xwbs);
                mx.draw_line(Mx, lingrad, xcc + sv.a1, y, xcc + sv.a2, y, 1);

                mx.shadowbox(Mx, xcc + p1, ycc, sw + 1, yss, 1, 2, "", 0); // TODO replace with something cooler
            }

        } else {
            x = xcc + m.trunc(xss / 2);
            if (sv.origin <= 2) {
                op1 = yss - op1 - sv.sw;
                p1 = yss - p1 - sw;
            }
            if (op === mx.XW_DRAW) {
                var arrow = sv.arrow; // int
                mx.shadowbox(Mx, xcc, ycc, xss - 1, arrow, mx.L_ArrowUp, 2, "", 0);
                mx.shadowbox(Mx, xcc, ycc + yss - arrow, xss - 1, arrow, mx.L_ArrowDown, 2, "", 0);
            }

            if (Mx.legacyRender) {
                mx.draw_line(Mx, Mx.fg, x, ycc + sv.a1, x, ycc + sv.a2);
                mx.shadowbox(Mx, xcc, ycc + p1, xss, sw + 1, 1, 2, "", 0);
            } else {
                var lingrad = ctx.createLinearGradient(0, ycc + sv.a1, 0, ycc + sv.a2);
                lingrad.addColorStop(0, Mx.xwbs);
                lingrad.addColorStop(0.5, Mx.xwts);
                lingrad.addColorStop(1, Mx.xwbs);
                mx.draw_line(Mx, lingrad, x, ycc + sv.a1, x, ycc + sv.a2);

                mx.shadowbox(Mx, xcc, ycc + p1, xss, sw + 1, 1, 2, "", 0); // TODO replace with something cooler
            }

        }

        sv.s1 = s1;
        sv.sw = sw;
    };

    /**
     * @method bound
     * @param a
     * @param b
     * @param c
     * @private
     */
    function bound(a, b, c) {
        return a < b ? b : (a > c ? c : a);
    }

    /**
     * @param {Object} Mx - the Mx object
     * @param {number} x - the real-world x coordinate
     * @param {number} y - the real-world y coordinate
     * @param {boolean} [clip=false] set to clip the returned value to the plot area
     * @returns {Object} pixel - the x,y coordinates in pixel coordinate space
     * @returns {number} pixel.clipped - true if the point would have or has been clipped
     * @private
     */
    mx.real_to_pixel = function(Mx, x, y, clip) {
        var stk4 = mx.origin(Mx.origin, 4, Mx.stk[Mx.level]);
        if ((stk4.xscl === 0.0) || (stk4.yscl === 0.0)) {
            return {
                x: 0,
                y: 0
            };
        }

        var left = stk4.x1;
        var top = stk4.y1;

        var xxmin = stk4.xmin;
        var xscl = 1.0 / stk4.xscl;

        var yymin = stk4.ymin;
        var yscl = 1.0 / stk4.yscl;
        
        var clipped = ((x > stk4.xmax) || (x < stk4.xmin) || (y > stk4.ymin) || (y < stk4.ymax));

        if (clip) {
            x = Math.min(x, stk4.xmax);
            y = Math.max(x, stk4.xmin);
            y = Math.min(y, stk4.ymin);
            y = Math.max(y, stk4.ymax);
        }

        var x = Math.round((x - xxmin) * xscl) + left;
        var y = Math.round((y - yymin) * yscl) + top;
        return {
            x: x,
            y: y,
            clipped: clipped
        };
    };

    /**
     * @param Mx
     * @param xpos
     * @param ypos
     * @private
     */
    mx.pixel_to_real = function(Mx, xpos, ypos) {
        var iretx = Math.min(Mx.r, Math.max(Mx.l, xpos));
        var irety = Math.min(Mx.b, Math.max(Mx.t, ypos));
        var retx;
        var rety;

        var k = Mx.level;
        if ((Mx.origin !== 2) && (Mx.origin !== 3)) {
            retx = Mx.stk[k].xmin + (iretx - Mx.stk[k].x1) * Mx.stk[k].xscl;
        } else {
            retx = Mx.stk[k].xmin + (Mx.stk[k].x2 - iretx) * Mx.stk[k].xscl;
        }
        if (Mx.origin > 2) {
            rety = Mx.stk[k].ymin + (irety - Mx.stk[k].y1) * Mx.stk[k].yscl;
        } else {
            rety = Mx.stk[k].ymin + (Mx.stk[k].y2 - irety) * Mx.stk[k].yscl;
        }

        return {
            x: retx,
            y: rety
        };
    };

    /**
     * @param Mx
     * @param map
     * @param ncolors
     * @private
     */
    mx.colormap = function(Mx, map, ncolors) {
        Mx.pixel = new Array(ncolors);
        var colorp = new Array(ncolors);

        var cf = 100.0 / (Math.max(2, ncolors) - 1);
        for (var n = 0; n < ncolors; n++) {
            colorp[n] = (cf * n) + 0.5;
        }

        var iz;
        for (iz = 0;
            (iz < 6) && (map[iz + 1].pos === 0); iz++) {}

        for (var n = 0; n < ncolors; n++) {
            Mx.pixel[n] = 0;
            var z = colorp[n];
            while ((iz < 6) && (Math.floor(z) > map[iz].pos)) { iz++; }
            if ((iz === 0) || (z >= map[iz].pos)) {
                // above, below, or directly on boundry
                Mx.pixel[n] = {
                    red: pc2px(map[iz].red),
                    green: pc2px(map[iz].green),
                    blue: pc2px(map[iz].blue)
                };
            } else {
                // interpolation my dear watson
                var pf = (z - map[iz - 1].pos) / (map[iz].pos - map[iz - 1].pos);
                var zf = pc2px(pf * 100);
                var zf1 = 255 - zf;
                Mx.pixel[n] = {
                    red: (zf * (map[iz].red / 100) + zf1 * (map[iz - 1].red / 100)),
                    green: (zf * (map[iz].green / 100) + zf1 * (map[iz - 1].green / 100)),
                    blue: (zf * (map[iz].blue / 100) + zf1 * (map[iz - 1].blue / 100))
                };
            }
        }
    };

    /**
     * @param Mx
     * @param x
     * @param y
     * @param w
     * @param h
     * @private
     */
    mx.colorbar = function(Mx, x, y, w, h) {
        for (var j = 1; j < h; j++) {
            var cidx = Math.floor(Mx.pixel.length * (j - 1) / h);
            mx.draw_line(Mx, cidx, x, y + h - j, x + w, y + h - j);
        }
        mx.draw_box(Mx, Mx.fg, x + 0.5, y, w, h);
    };

    /**
     * Render image buffer to canvas.
     *
     * If we don't have access to Uint8ClampedArray (i.e. Firefox 3.6)
     * use a slower approach that only supports rasters up to the size
     * limit of the canvas
     * @private
     *
     * @param ctx
     *   {context} a canvas 2d context
     * @param buf
     *   {ArrayBuffer} a buffer of 32-bit image data 
     * @param opacity
     *   the opacity to render the image with
     * @param smoothing
     *   if image smoothing should be enabled
     * @param sx
     *   source x position
     * @param sy
     *   source y position
     * @param sw
     *   source width
     * @param sh
     *   source height
     * @param x 
     *   optional x canvas dest
     * @param y 
     *   optional y canvas dest
     * @param w 
     *   optional width
     * @param h 
     *   optional height
     */
    function renderImageNoTypedArrays(Mx, ctx, buf, opacity, smoothing, x, y, w, h, sx, sy, sw, sh) {
	if (sx === undefined) { sx = 0; }
	if (sy === undefined) { sy = 0; }
	if (sw === undefined) { sw = buf.width - sx; }
	if (sh === undefined) { sh = buf.height - sy; }

	// If the source buffer is small enough to be directly rendered, do that
	Mx._renderCanvas.width = buf.width;
	Mx._renderCanvas.height = buf.height;

	var imgctx = Mx._renderCanvas.getContext("2d");
	var imgd = imgctx.createImageData(Mx._renderCanvas.width, Mx._renderCanvas.height);
        var buf8 = new Uint8Array(buf);
	for (var yy=0; yy<buf.height; ++yy) {
	    for (var xx=0; xx<buf.width; ++xx) {
		var index = ((yy*buf.width) + xx) * 4;
		imgd.data[index  ] = buf8[index  ]; // red
		imgd.data[index+1] = buf8[index+1]; // green
		imgd.data[index+2] = buf8[index+2]; // blue
		imgd.data[index+3] = 255; // alpha
	    }
	}
	imgctx.putImageData(imgd, 0, 0);

	// Render the image to the destination
	ctx.save();
	ctx.globalAlpha = opacity;
	if (!smoothing) {
	    ctx.imageSmoothingEnabled = false;
	    ctx.mozImageSmoothingEnabled = false;
	    ctx.webkitImageSmoothingEnabled = false;
	}
	ctx.drawImage(Mx._renderCanvas, sx, sy, sw, sh, x, y, w, h);
	ctx.restore();
    }

    /**
     * @private
     *
     * @param ctx
     *   {context} a canvas 2d context
     * @param buf
     *   {ArrayBuffer} a buffer of 32-bit image data 
     * @param opacity
     *   the opacity to render the image with
     * @param smoothing
     *   if image smoothing should be enabled
     * @param sx
     *   source x position
     * @param sy
     *   source y position
     * @param sw
     *   source width
     * @param sh
     *   source height
     * @param x 
     *   optional x canvas dest
     * @param y 
     *   optional y canvas dest
     * @param w 
     *   optional width
     * @param h 
     *   optional height
     */
    function renderImageTypedArrays(Mx, ctx, buf, opacity, smoothing, x, y, w, h, sx, sy, sw, sh) {
	if (sx === undefined) { sx = 0; }
	if (sy === undefined) { sy = 0; }
	if (sw === undefined) { sw = buf.width - sx; }
	if (sh === undefined) { sh = buf.height - sy; }

        if ((buf.width < 32768) && (buf.height < 32768)) {
            // If the source buffer is small enough to be directly rendered, do that
	    Mx._renderCanvas.width = buf.width;
	    Mx._renderCanvas.height = buf.height;

	    var imgctx = Mx._renderCanvas.getContext("2d");
	    var imgd = imgctx.createImageData(Mx._renderCanvas.width, Mx._renderCanvas.height);

            // TODO - This may not be portable to all browsers, if not
	    // we need to choose between this approach and the traditional
	    // for-loop based approach
            var buf8 = new Uint8ClampedArray(buf);
	    imgd.data.set(buf8);
	    imgctx.putImageData(imgd, 0, 0);
        } else {
            if ((sw < 32768) && (sh < 32768)) {
	        // The clipped image is small enough to directly render
		Mx._renderCanvas.width = sw;
		Mx._renderCanvas.height = sh;
		scaleImage(Mx._renderCanvas, buf, sx, sy, sw, sh);
	    } else {
		// Downscale to twice the destination size
		Mx._renderCanvas.width = Math.min(w*2, buf.width);
		Mx._renderCanvas.height = Math.min(h*2, buf.height);
		scaleImage(Mx._renderCanvas, buf, sx, sy, sw, sh);
		sw = Mx._renderCanvas.width;
		sh = Mx._renderCanvas.height;
	    }
	    sx = 0;
	    sy = 0;
        }

	// Render the image to the destination
        ctx.save();
        ctx.globalAlpha = opacity;
        if (!smoothing) {
            ctx.imageSmoothingEnabled = false;
            ctx.mozImageSmoothingEnabled = false;
            ctx.webkitImageSmoothingEnabled = false;
        }
        ctx.drawImage(Mx._renderCanvas, sx, sy, sw, sh, x, y, w, h);
        ctx.restore();
    }

    /**
     * Scale the image data (represented by buf) into the destination canvas
     * using nearest neighbor.  In genearl, you should just use the scaling
     * provided by drawImage...but if the buf is greater than 32767 pixels in
     * either dimension that won't work and you have to use this.
     *
     * @param img
     *   A canvas object
     * @param buf
     *   An ArrayBuf with .width and .height elements
     *
     * @private
     */
    function scaleImage(img, buf, sx, sy, sw, sh) {
	// Source buffer, expected to have .width and .height elements
	var src = new Uint32Array(buf);

	if (!sw) {
	    sw = buf.width;
	}
	if (!sh) {
	    sh = buf.height;
	}
	if (!sx) {
	    sx = 0;    
	}
	if (!sy) {
	    sy = 0;    
	}

	// Cache to avoid get width calls in tight loop
	var w = img.width;
	var h = img.height;

	// Destination element
	var imgctx = img.getContext("2d");
	var imgd = imgctx.createImageData(w, h);
	var ibuf = new ArrayBuffer(imgd.data.length);
	var buf8 = new Uint8ClampedArray(ibuf);
	var dest = new Uint32Array(ibuf);

	// Scaling factor
	var width_scaling = sw / w;
	var height_scaling = sh / h;

        // Perform the scaling	
	var xx = 0;
	var yy = 0;
	var jj = 0;
	for (var i=0; i<dest.length; i++) {
	    xx = Math.round(Math.floor(i % w) * width_scaling) + sx;
	    yy = Math.round(Math.floor(i / w) * height_scaling) + sy;
	    jj = Math.floor((yy*buf.width) + xx);
	    dest[i] = src[jj];
	}

	// Set the data
	imgd.data.set(buf8);
	imgctx.putImageData(imgd, 0, 0);
    }

    var renderImage = (typeof Uint8ClampedArray === 'undefined') ? renderImageNoTypedArrays : renderImageTypedArrays;

    /**
     * @param Mx
     * @param img
     * @param shift
     * @private
     */
    mx.shift_image_rows = function(Mx, buf, shift) {
        var imgd = new Uint32Array(buf);
        if (shift > 0) { // shift down
            shift = shift*buf.width;
            imgd.set(imgd.subarray(0, imgd.length-shift) , shift);
        } else if (shift < 0) { // shift up
            shift = Math.abs(shift)*buf.width;
            imgd.set(imgd.subarray(shift));
        }

        return buf;
    };

    /**
     * @param Mx
     * @param img
     * @param data
     * @param row
     * @param zmin
     * @param zmax
     * @private
     */
    mx.update_image_row = function(Mx, buf, data, row, zmin, zmax) {
        var imgd = new Uint32Array(buf, row*buf.width*4, buf.width);
        
        var fscale = 1;
        if (zmax !== zmin) {
            fscale = Mx.pixel.length / Math.abs(zmax - zmin); // number of colors spread across the zrange
        }
        for (var i = 0; i < data.length; i++) {

            var cidx = Math.floor((data[i] - zmin) * fscale);
            cidx = Math.max(0, Math.min(Mx.pixel.length - 1, cidx));

            var color = Mx.pixel[cidx];
            if (color) {
		/*jshint bitwise: false */
                imgd[i] = (255         << 24) | // alpha
                          (color.blue  << 16) | // blue
                          (color.green <<  8) | // green
                          (color.red        );  // red
		/*jshint bitwise: true */
            }
        }

        return buf;
    };

    /**
     * @param Mx
     * @param data
     * @param w
     * @param h
     * @param Mx
     * @param zmin
     * @param zmax
     * @private
     */
    mx.create_image = function(Mx, data, w, h, zmin, zmax) {
        var ctx = Mx.active_canvas.getContext("2d");

        if (!Mx.pixel || Mx.pixel.length === 0) {
            m.log.warn("COLORMAP not initialized, defaulting to foreground");
            mx.colormap(Mx, m.Mc.colormap[1], 16);
        }

        var fscale = 1;
        if (zmax !== zmin) {
            fscale = Mx.pixel.length / Math.abs(zmax - zmin); // number of colors spread across the zrange
        }

        w = Math.ceil(w);
        h = Math.ceil(h);
        var buf = new ArrayBuffer(w*h*4);
        buf.width = w;
        buf.height = h;

        var imgd = new Uint32Array(buf);
        for (var i = 0; i < imgd.length; i++) {
            var ix;
            var iy;
            if ((Mx.origin === 1) || (Mx.origin === 4)) {
                ix = Math.floor(i % w);
            } else {
                ix = w - Math.floor(i % w) - 1;
            }
            if ((Mx.origin === 3) || (Mx.origin === 4)) {
                iy = Math.floor(i / w);
            } else {
                iy = h - Math.floor(i / w) - 1;
            }
            var didx = (iy * w) + ix;

            var cidx = Math.floor((data[didx] - zmin) * fscale);
            cidx = Math.max(0, Math.min(Mx.pixel.length - 1, cidx));

            var color = Mx.pixel[cidx];
            if (color) {
		/*jshint bitwise: false */
                imgd[i] = (255         << 24) | // alpha
                          (color.blue  << 16) | // blue
                          (color.green <<  8) | // green
                          (color.red        );  // red
		/*jshint bitwise: true */
            }
        }

        // Return the image in case the caller wishes to cache it
        return buf;
    };

    /**
     * @param Mx
     * @param data
     * @param nx
     * @param ny
     * @param nex
     * @param ney
     * @param xd
     * @param yd
     * @param level
     * @param opacity
     * @param smoothing
     * @private
     */
    mx.put_image = function(Mx, data, nx, ny, nex, ney, xd, yd, level, opacity, smoothing) {
        var ctx = Mx.active_canvas.getContext("2d");

        if (!Mx.pixel || Mx.pixel.length === 0) {
            m.log.warn("COLORMAP not initialized, defaulting to foreground");
            mx.colormap(Mx, m.Mc.colormap[1], 16);
        }

        var w;
        var h;

        if (nex > 0) {
            w = nx * nex;
        } else {
            w = -nex;
        }
        w = Math.floor(w);
        h = Math.floor(ny * ney);

        var buf = new ArrayBuffer(w*h*4);
        buf.width = w;
        buf.height = h;

        var imgd = new Uint32Array(buf);
        for (var i = 0; i < imgd.length; i++) {
            var cidx = Math.max(0, data[i]);
            cidx = Math.min(Mx.pixel.length - 1, cidx);

            var color = Mx.pixel[cidx];
            if (color) {
		/*jshint bitwise: false */
                imgd[i] = (255         << 24) | // alpha
                          (color.blue  << 16) | // blue
                          (color.green <<  8) | // green
                          (color.red        );  // red
		/*jshint bitwise: true */
            }
        }

        //render the buffered canvas onto the original canvas element
        renderImage(Mx, ctx, buf, opacity, smoothing, xd, yd, w, h);

        // Return the image in case the caller wishes to cache it
        return buf;
    };

    /**
     * @param Mx
     * @param buf
     * @param xmin
     * @param ymin
     * @param xmax
     * @param ymax
     * @param opacity
     * @param smoothing
     * @private
     */
    mx.draw_image = function(Mx, buf, xmin, ymin, xmax, ymax, opacity, smoothing) {
        var view_xmin = Math.max(xmin, Mx.stk[Mx.level].xmin);
        var view_xmax = Math.min(xmax, Mx.stk[Mx.level].xmax);
        var view_ymin = Math.max(ymin, Mx.stk[Mx.level].ymin);
        var view_ymax = Math.min(ymax, Mx.stk[Mx.level].ymax);


        if ((buf.width <= 1) || Math.abs(xmax-xmin) === 0) {
            return;
        }
        if ((buf.height <= 1) || Math.abs(ymax-ymin) === 0) {
            return;
        }
        var rx = (buf.width - 1) / (xmax - xmin);
        var sx = Math.max(0, Math.floor((view_xmin - xmin) * rx));
        var sw = Math.min(buf.width, buf.width - Math.floor((xmax - view_xmax) * rx) - sx);

        var ry = (buf.height - 1) / (ymax - ymin);
        var sy = Math.max(0, Math.floor((view_ymin - ymin) * ry));
        var sh = Math.min(buf.height, buf.height - Math.floor((ymax - view_ymax) * ry) - sy);

        var ul;
        var lr;
        if (Mx.origin === 1) {
            // regular x, regular y
            ul = mx.real_to_pixel(Mx, view_xmin, view_ymax);
            lr = mx.real_to_pixel(Mx, view_xmax, view_ymin);
        } else if (Mx.origin === 2) {
            // inverted x, regular y
            ul = mx.real_to_pixel(Mx, view_xmax, view_ymax);
            lr = mx.real_to_pixel(Mx, view_xmin, view_ymin);
        } else if (Mx.origin === 3) {
            // inverted x, inverted y
            ul = mx.real_to_pixel(Mx, view_xmax, view_ymin);
            lr = mx.real_to_pixel(Mx, view_xmin, view_ymax);
        } else if (Mx.origin === 4) {
            // regular x, inverted y
            ul = mx.real_to_pixel(Mx, view_xmin, view_ymin);
            lr = mx.real_to_pixel(Mx, view_xmax, view_ymax);
        }

        var iw = lr.x - ul.x;
        var ih = lr.y - ul.y;

        //render the buffered canvas onto the original canvas element
        var ctx = Mx.active_canvas.getContext("2d");
        renderImage(Mx, ctx, buf, opacity, smoothing, ul.x, ul.y, iw, ih, sx, sy, sw, sh);
    };

}(window.mx, window.m));

///////////////////////////////////////////////////////////////////////////////

/**
 * @license
 * File: sigplot.layer1d.js
 * Copyright (c) 2012-2014, Michael Ihde, All rights reserved.
 * Copyright (c) 2012-2014, Axios Inc., All rights reserved.
 *
 * This file is part of SigPlot.
 *
 * SigPlot is free software; you can redistribute it and/or modify it under the terms of the GNU Lesser
 * General Public License as published by the Free Software Foundation; either version 3.0 of the License, or
 * (at your option) any later version. This library is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE. See the GNU Lesser General Public License for more details. You should have received a copy of the
 * GNU Lesser General Public License along with SigPlot.
 */

/* global mx */
/* global m */
(function(sigplot, mx, m, undefined) {


    /**
     * @constructor
     * @param plot
     */

    sigplot.Layer1D = function(plot) {
        this.plot = plot;

        this.xbuf = undefined; // raw (ArrayBuffer) of ABSC data
        this.ybuf = undefined; // raw (ArrayBuffer) of ORD data

        this.offset = 0.0;
        this.xstart = 0.0;
        this.xdelta = 0.0;
        this.imin = 0;
        this.xmin = 0.0;
        this.xmax = 0.0;
        this.name = "";
        this.cx = false;
        this.hcb = undefined; // index in Gx.HCB
        // xbufn = xbuf.byteLength
        // ybufn = ybuf.byteLength
        this.size = 0;

        this.display = true;
        this.color = 0;
        this.line = 3; // 0=none, 1-vertical, 2-horizontal, 3-connecting
        this.thick = 1; // negative for dashed
        this.symbol = 0;
        this.radius = 3;

        this.skip = 0; // number of elements between ord values
        this.xsub = 0;
        this.ysub = 0;
        this.xdata = false; // true if X data is data from file
        this.modified = false;
        this.opacity = 1.0;
        this.preferred_origin = 1;

        this.options = {};
    };

    sigplot.Layer1D.prototype = {

        /**
         * Initializes the layer to display the provided data.
         *
         * @param hcb
         *            {BlueHeader} an opened BlueHeader file
         * @param lyrn
         *          the index of the added layer
         *
         * @memberOf sigplot.Layer1D
         * @private
         */
        init: function(hcb, options) {
            var Gx = this.plot._Gx;

            this.hcb = hcb;
            this.hcb.buf_type = "D";

            this.offset = 0;
            this.size = 0;
            this.xbufn = 0;
            this.ybufn = 0;

            if (!this.hcb.pipe) {
		if (hcb["class"] === 2) {
                    m.force1000(hcb);
                    this.size = hcb.subsize;
                } else {
                    this.size = hcb.size;
                }
            } else {
		this.size = options.framesize;
            }

            if (hcb["class"] <= 2) {
                this.xsub = -1;
                this.ysub = 1;
                this.cx = (hcb.format[0] === 'C');
            } else {
                // TODO
            }

            this.skip = 1;
            if (this.cx) {
                this.skip = 2;
            }

            this.xstart = hcb.xstart;
            this.xdelta = hcb.xdelta;
            var d = hcb.xstart + hcb.xdelta * (this.size - 1.0);
            this.xmin = Math.min(hcb.xstart, d);
            this.xmax = Math.max(hcb.xstart, d);

            this.xlab = hcb.xunits;
            this.ylab = hcb.yunits; // might be undefined

            if (this.hcb.pipe) {
		this.drawmode = "scrolling";
		this.position = 0;
		this.tle = options.tl;

		this.ybufn = this.size * Math.max(this.skip * sigplot.PointArray.BYTES_PER_ELEMENT, sigplot.PointArray.BYTES_PER_ELEMENT);
		this.ybuf = new ArrayBuffer(this.ybufn);

		var self = this;
		m.addPipeWriteListener(this.hcb, function() { self._onpipewrite(); });
            }
        },

        _onpipewrite : function() {
            var ybuf = new sigplot.PointArray(this.ybuf);

            var tle = this.tle; // in scalars
            if (tle === undefined) {
		tle = Math.floor(m.pavail(this.hcb)) / this.hcb.spa;
            } else if (m.pavail(this.hcb) < (tle*this.hcb.spa)) {
                return;
            }

            var tl = tle * this.hcb.spa;

            if (this.drawmode === "lefttoright") {
		this.position = 0;
		ybuf.set(ybuf.subarray(0, this.size-tl), tl);
            } else if (this.drawmode === "righttoleft") {
		this.position = this.size-tle;
		ybuf.set(ybuf.subarray(tl), 0);
            } else if (this.drawmode === "scrolling") {
		// Nothing to do
            } else {
		throw "Invalid draw mode";
            }

            tle = Math.min(tle, this.size-this.position);
            var ngot = m.grabx(this.hcb, ybuf, tle*this.hcb.spa, this.position*this.hcb.spa);
            if (ngot === 0) {
                return;
            }

            this.position = (this.position + tle) % this.size;
        },

        get_data: function(xmin, xmax) {
            var Gx = this.plot._Gx;
            var HCB = this.hcb;

            var skip = this.skip;

            var size;
            if (HCB["class"] === 2) {
                size = HCB.subsize;
            } else {
                size = HCB.size;
            }

            var imin = 0;
            var imax = 0;
            if (Gx.index) {
                imin = Math.floor(xmin);
                imax = Math.floor(xmax + 0.5);
            } else if (HCB.xdelta >= 0.0) {
                imin = Math.floor((xmin - HCB.xstart) / HCB.xdelta) - 1;
                imax = Math.floor((xmax - HCB.xstart) / HCB.xdelta + 0.5);
            } else {

                imin = Math.floor((xmax - HCB.xstart) / HCB.xdelta) - 1;
                imax = Math.floor((xmin - HCB.xstart) / HCB.xdelta + 0.5);
            }
            imin = Math.max(0.0, imin);
            imax = Math.min(size, imax);

            var npts = Math.max(0.0, Math.min(imax - imin + 1, Gx.bufmax));
            if (HCB.xdelta < 0) {
                imin = imax - npts + 1;
	    }

            if ((imin >= this.imin) && (imin + npts <= this.imin + this.size) && (this.ybuf !== undefined)) {
                // data already in buffers
            } else if (this.modified) {
                // modified data not yet saved off

            } else if (HCB["class"] <= 2) {
                // load new data
                var start = this.offset + imin;
                var skip = this.skip;
                this.ybufn = npts * Math.max(skip * sigplot.PointArray.BYTES_PER_ELEMENT,
                    sigplot.PointArray.BYTES_PER_ELEMENT);
                if ((this.ybuf === undefined) || (this.ybuf.byteLength < this.ybufn)) {
                    this.ybuf = new ArrayBuffer(this.ybufn);
                }
                var ybuf = new sigplot.PointArray(this.ybuf);
                var ngot = m.grab(HCB, ybuf, start, npts);
                this.imin = imin;
                this.xstart = HCB.xstart + (imin) * this.xdelta;
                this.size = ngot;
            } else {
                // type 3000, 4000, 5000
                // TODO yeah right
            }

        },

        change_settings: function(settings) {
            if (settings.index !== undefined) {
                if (settings.index) {
                    this.xstart = 1.0;
                    this.xdelta = 1.0;
                    this.xmin = 1.0;
                    this.xmax = this.size;
                } else {
                    this.xstart = this.hcb.xstart + (this.imin) * this.xdelta;
                    this.xdelta = this.hcb.xdelta;
                    var d = this.hcb.xstart + this.hcb.xdelta * (this.size - 1.0);
                    this.xmin = Math.min(this.hcb.xstart, d);
                    this.xmax = Math.max(this.hcb.xstart, d);
                }
            }

            if (settings.drawmode !== undefined) {
		this.drawmode = settings.drawmode;
		// Reset the buffer
		this.position = 0;
		this.ybufn =  this.size * Math.max(this.skip * sigplot.PointArray.BYTES_PER_ELEMENT, sigplot.PointArray.BYTES_PER_ELEMENT);
		this.ybuf = new ArrayBuffer(this.ybufn);
            }
        },
       
        reload: function(data, hdrmod) {

            var axis_change = (this.hcb.dview.length !== data.length) || hdrmod;
            if (hdrmod) {
                for (var k in hdrmod) {
                    this.hcb[k] = hdrmod[k];
                }
            }
            this.hcb.setData(data);

            // Setting these causes refresh() to refetch 
            this.imin = 0;
            this.xstart = undefined;
            this.size = 0;

            var xmin = this.xmin;
            var xmax = this.xmax;

            if (axis_change) {
                var d = this.hcb.xstart + this.hcb.xdelta * (this.hcb.size - 1.0);
                this.xmin = Math.min(this.hcb.xstart, d);
                this.xmax = Math.max(this.hcb.xstart, d);
                this.xdelta = this.hcb.xdelta;
                this.xstart = this.hcb.xstart;
                xmin = undefined;
                xmax = undefined;
            }

            return {xmin: xmin, xmax: xmax};
        },         
        
        push: function(data, hdrmod, sync) {
            if (hdrmod) {
                for (var k in hdrmod) {
                    this.hcb[k] = hdrmod[k];
                }
                      
                var d = this.hcb.xstart + this.hcb.xdelta * (this.hcb.size - 1.0);
                this.xmin = Math.min(this.hcb.xstart, d);
                this.xmax = Math.max(this.hcb.xstart, d);
                this.xdelta = this.hcb.xdelta;
                this.xstart = this.hcb.xstart;
            }

            m.filad(this.hcb, data, sync);

            return hdrmod ? true : false;
            
        },

        prep: function(xmin, xmax) {
            var Gx = this.plot._Gx;
            var Mx = this.plot._Mx;

            var npts = Math.ceil(this.size);

            var skip = this.skip;

            if (npts === 0) { return; }

            if (npts * sigplot.PointArray.BYTES_PER_ELEMENT > Gx.pointbufsize) {
                Gx.pointbufsize = npts * sigplot.PointArray.BYTES_PER_ELEMENT;
                Gx.xptr = new ArrayBuffer(Gx.pointbufsize);
                Gx.yptr = new ArrayBuffer(Gx.pointbufsize);
            }

            var dbuf = new sigplot.PointArray(this.ybuf);
            var xpoint = new sigplot.PointArray(Gx.xptr);
            var qmin = this.xmin;
            var qmax = this.xmax;
            var n1, n2;
            var mxmn;
            if ((Gx.cmode === 5) || (this.xsub > 0)) {
                if (npts <= 0) {
                    qmin = Gx.panxmin;
                    qmax = Gx.panxmax;
                } else if (Gx.cmode !== 5) {
                    xpoint = new sigplot.PointArray(this.xbuf);
                } else if (this.cx) {
                    m.vmov(dbuf, skip, xpoint, 1, npts);
                } else if (this.line !== 0) {
                    mxmn = m.vmxmn(dbuf, npts);
                    xpoint[0] = mxmn.smax;
                    xpoint[1] = mxmn.smin;
                    n1 = mxmn.imax;
                    n2 = mxmn.imin;
                    npts = 2;
                } else {
                    xpoint = dbuf;
                }
                if (npts > 0) {
                    mxmn = m.vmxmn(xpoint, npts);
                    qmax = mxmn.smax;
                    qmin = mxmn.smin;
                    n1 = mxmn.imax;
                    n2 = mxmn.imin;
                }
            } else if (npts > 0) {
                var xstart = this.xstart;
                var xdelta = this.xdelta;
                var d = npts;
                if (Gx.index) {
                    n1 = 0;
                    n2 = npts - 1;
                } else if (xdelta >= 0.0) {
                    n1 = Math.max(1.0, Math.min(d, Math.round((xmin - xstart) / xdelta))) - 1.0;
                    n2 = Math.max(1.0, Math.min(d, Math.round((xmax - xstart) / xdelta) + 2.0)) - 1.0;
                } else {
                    n1 = Math.max(1.0, Math.min(d, Math.round((xmax - xstart) / xdelta) - 1.0)) - 1.0;
                    n2 = Math.max(1.0, Math.min(d, Math.round((xmin - xstart) / xdelta) + 2.0)) - 1.0;
                }

                npts = n2 - n1 + 1;
                if (npts < 0) {
		    m.log.debug("Nothing to plot");
                    npts = 0;
                }
                dbuf = new sigplot.PointArray(this.ybuf).subarray(n1 * skip);
                xstart = xstart + xdelta * (n1);
                for (var i = 0; i < npts; i++) {
                    if (Gx.index) {
                        xpoint[i] = this.imin + i + 1;
                    } else {
                        xpoint[i] = xstart + i * xdelta;
                    }
                }
            }

            if (Gx.panxmin > Gx.panxmax) {
                Gx.panxmin = qmin;
                Gx.panxmax = qmax;
            } else {
                Gx.panxmin = Math.min(Gx.panxmin, qmin);
                Gx.panxmax = Math.max(Gx.panxmax, qmax);
            }

            if (npts <= 0) {
                m.log.debug("Nothing to plot");
                return;
            }
            var ypoint = new sigplot.PointArray(Gx.yptr);
            if (this.cx) {
                if (Gx.cmode === 1) {
                    m.cvmag(dbuf, ypoint, npts);
                } else if (Gx.cmode === 2) {
                    if (Gx.plab === 25) {
                        m.cvpha(dbuf, ypoint, npts);
                        m.vsmul(ypoint, 1.0 / (2 * Math.PI), ypoint, npts);
                    } else if (Gx.plab !== 24) {
                        m.cvpha(dbuf, ypoint, npts);
                    } else {
                        m.cvphad(dbuf, ypoint, npts);
                    }
                } else if (Gx.cmode === 3) {
                    m.vmov(dbuf, skip, ypoint, 1, npts);
                } else if (Gx.cmode >= 6) {
                    m.cvmag2(dbuf, ypoint, npts);
                } else if (Gx.cmode >= 4) {
                    m.vmov(dbuf.subarray(1), skip, ypoint, 1, npts);
                }
            } else {
                if (Gx.cmode === 5) { // I vs. R
                    m.vfill(ypoint, 0, npts);
                } else if ((Gx.cmode === 1) || (Gx.cmode >= 6)) { // Mag, log
                    for (var i = 0; i < npts; i++) {
                        ypoint[i] = Math.abs(dbuf[i]);
                    }
                } else {
                    for (var i = 0; i < npts; i++) {
                        ypoint[i] = dbuf[i];
                    }
                }
            }

            if (Gx.cmode >= 6) {
                m.vlog10(ypoint, Gx.dbmin, ypoint);
                var dbscale = 10.0;
                if (Gx.cmode === 7) {
                    dbscale = 20.0;
                }
                if ((Gx.lyr.length > 0) && (Gx.lyr[0].cx)) {
                    dbscale = dbscale / 2.0;
                }
                m.vsmul(ypoint, dbscale, ypoint);
            }
            mxmn = m.vmxmn(ypoint, npts);

            qmax = mxmn.smax;
            qmin = mxmn.smin;
            n1 = mxmn.imax;
            n2 = mxmn.imin;

            var yran = qmax - qmin;
            if (yran < 0.0) {
                qmax = qmin;
                qmin = qmax + yran;
                yran = -yran;
            }
            if (yran <= 1.0e-20) {
                qmin = qmin - 1.0;
                qmax = qmax + 1.0;
            } else {
                qmin = qmin - 0.02 * yran;
                qmax = qmax + 0.02 * yran;
            }

            if (Mx.level === 0) {
                if (Gx.panymin > Gx.panymax) {
                    Gx.panymin = qmin;
                    Gx.panymax = qmax;
                } else {
                    Gx.panymin = Math.min(Gx.panymin, qmin);
                    Gx.panymax = Math.max(Gx.panymax, qmax);
                }

                if (Gx.autol > 1) {
                    var fac = 1.0 / (Math.max(Gx.autol, 1));
                    Gx.panymin = Gx.panymin * fac + Mx.stk[0].ymin * (1.0 - fac);
                    Gx.panymax = Gx.panymax * fac + Mx.stk[0].ymax * (1.0 - fac);
                }
            }

            // Gx.xptr = xpoint;
            // Gx.yptr = ypoint;
            return npts;
        },

        draw: function() {
            var Mx = this.plot._Mx;
            var Gx = this.plot._Gx;

            var ic = this.color;
            var symbol = this.symbol;
            var rad = this.radius;
            var mask = 0;
            var line = 0;
            var traceoptions = {};

            traceoptions.fillStyle = Gx.fillStyle;
            if (this.options) {
                traceoptions.highlight = this.options.highlight;
                traceoptions.noclip = this.options.noclip;
            }

            if (this.line === 0) {
                line = 0;
            } else {
                line = 1;
                if (this.thick > 0) {
                    line = this.thick;
                } else if (this.thick < 0) {
                    line = Math.abs(this.thick);
                    traceoptions.dashed = true;
                }
                if (this.line === 1) {
                    traceoptions.vertsym = true;
		}
                if (this.line === 2) {
                    traceoptions.horzsym = true;
		}
            }

            var segment = (Gx.segment) && (Gx.cmode !== 5) && (this.xsub > 0) && (mask === 0);
            var xdelta = this.xdelta;

            var xmin;
            var xmax;
            if (this.xdata) {
                xmin = this.xmin;
                xmax = this.xmax;
            } else {
                xmin = Math.max(this.xmin, Mx.stk[Mx.level].xmin);
                xmax = Math.min(this.xmax, Mx.stk[Mx.level].xmax);
                if (xmin >= xmax) { // no data but do scaling
                    Gx.panxmin = Math.min(Gx.panxmin, this.xmin);
                    Gx.panxmax = Math.max(Gx.panxmax, this.xmax);
                }
            }

            if (!Gx.all) {
                var xran = (Gx.bufmax - 1.0) * xdelta;
                if (xran >= -0.0) {
                    xmax = Math.min(xmax, xmin + xran);
                } else {
                    xmin = Math.max(xmin, xmax + xran);
                }
            }

            if ((line === 0) && (symbol === 0)) {
                // Nothing to draw
                return;
            }
            while (xmin < xmax) {
                //if (Gx.all) {
                // TODO allow interrupt of all by mouse clicks
                //}

                if (!this.hcb.pipe) {
                    // get_data fills in the layer xbuf/ybuf with data
                    this.get_data(xmin, xmax);
                }

                // sigplot_prep fills in Gx.xptr and Gx.yptr (both sigplot.PointArray)
                // with the data to be plotted

                var npts = this.prep(xmin, xmax);
                if (npts > 0) {
                    if (segment) {
                        // TODO
                    } else {
                        mx.trace(Mx, ic, new sigplot.PointArray(Gx.xptr), new sigplot.PointArray(
                            Gx.yptr), npts, 1, line, symbol, rad, traceoptions);
                    }
                }

                if (Gx.all) {
                    if (this.size === 0) {
                        xmin = xmax;
                    } else {
                        if (Gx.index) {
                            xmin = xmin + npts;
                        } else {
                            if (xdelta >= 0) {
                                xmin = xmin + (this.size * xdelta);
                            } else {
                                xmax = xmax + (this.size * xdelta);
                            }
                        }
                    }
                } else {
                    xmin = xmax;
                }
            }

            if ((this.position) && (this.drawmode === "scrolling")) {
                var pnt = mx.real_to_pixel(Mx, this.position*this.xdelta, 0);
                if ((pnt.x > Mx.l) && (pnt.x < Mx.r)) {
                    mx.draw_line(Mx, "white", pnt.x, Mx.t, pnt.x, Mx.b);
                }
            }
        },

        /**
         * Add a highlight to a specific layer.
         *
         * @param {Number}
         *            n the layer to add the highlight to
         * @param highlight
         *            the highlight to add
         * @param {Number}
         *            highlight.xmin the minimum x value to start the highlight
         *            at
         * @param {Number}
         *            highlight.xmax the maximum x value to start the highlight
         *            at
         * @param {String}
         *            hightlight.color the color to use for the highlight
         *
         * @param {String}
         *            hightlight.id the id for the highlight
         */
        add_highlight : function(highlight) {
            if (!this.options.highlight) {
                this.options.highlight = [];
            }

            if (highlight instanceof Array) {
                this.options.highlight.push.apply(
                this.options.highlight, highlight);
            } else {
                this.options.highlight.push(highlight);
            }
            this.plot.refresh();
        },

        /**
         * Remove a highlight from the layer.
         *
         * @param {String} {Object}
         *             the id of the highlight to remove
         *             or the highlight object itself
         */
        remove_highlight : function(highlight) {
            if (this.options.highlight) {
                var i = this.options.highlight.length;
                while (i--) {
                if ((highlight === this.options.highlight[i]) || (highlight === this.options.highlight[i].id)) {
                    this.options.highlight.splice(i, 1);
                }
                }
                this.plot.refresh();
            }
        },

        get_highlights: function(){
            if (this.options.highlight) {
                return this.options.highlight.slice(0);
            } else {
                return [];
            }
        },

        /**
         * Clear all highlights from the layer.
         */
        clear_highlights : function() {
            if (this.options.highlight) {
                this.options.highlight = undefined;
                this.plot.refresh();
            }
        }
    };

    /**
     * Color positions for the various layers
     *
     * These magic numbers were conjured up by a wizard somewhere.
     *
     * @memberOf sigplot
     * @private
     */
    var mixc = [0, 53, 27, 80, 13, 40, 67, 93, 7, 60, 33, 87, 20, 47, 73, 100];

    /**
     * Factory to overlay the given file onto the given plot.
     *
     * @private
     */
    sigplot.Layer1D.overlay = function(plot, hcb, layerOptions) {
        var Gx = plot._Gx;
        var Mx = plot._Mx;

        if (hcb["class"] === 2) {
            m.force1000(hcb);
        }
        hcb.buf_type = "D";

        // If the input is type 2000, each row becomes
        // it's own layer
        var n1 = 0;
        var n2 = 1;
        if (hcb["class"] === 2) {
            var num_rows = hcb.size / hcb.subsize;
            n2 = Math.min(num_rows, 16 - Gx.lyr.length);
        }

        for (var i = n1; i < n2; i++) {
            // This is logic from within sigplot.for LOAD_FILES
            var layer = new sigplot.Layer1D(plot);
            layer.init(hcb, layerOptions);

            // Provide a default color for the layer
            var n = (Gx.lyr.length) % mixc.length;
            layer.color = mx.getcolor(Mx, m.Mc.colormap[3], mixc[n]);

            // Provide the layer name
            if (hcb["class"] === 2) {
                if (hcb.file_name) {
                    layer.name = m.trim_name(hcb.file_name);
                } else {
                    layer.name = "layer_" + Gx.lyr.length;
                }
                layer.name = layer.name + "." + mx.pad((i + 1).toString(), 3, "0");
                layer.offset = i * hcb.subsize;
            } else {
                if (hcb.file_name) {
                    layer.name = m.trim_name(hcb.file_name);
                } else {
                    layer.name = "layer_" + Gx.lyr.length;
                }
                layer.offset = 0;
            }

            for (var layerOption in layerOptions) {
                if (layer[layerOption] !== undefined) {
                    layer[layerOption] = layerOptions[layerOption];
                }
            }
            plot.add_layer(layer);
        }
    };

}(window.sigplot = window.sigplot || {}, mx, m));

/**
 * @license
 * File: sigplot.layer2d.js
 * Copyright (c) 2012-2014, Michael Ihde, All rights reserved.
 * Copyright (c) 2012-2014, Axios Inc., All rights reserved.
 *
 * This file is part of SigPlot.
 *
 * SigPlot is free software; you can redistribute it and/or modify it under the terms of the GNU Lesser
 * General Public License as published by the Free Software Foundation; either version 3.0 of the License, or
 * (at your option) any later version. This library is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE. See the GNU Lesser General Public License for more details. You should have received a copy of the
 * GNU Lesser General Public License along with SigPlot.
 */

/* global mx */
/* global m */
(function(sigplot, mx, m, undefined) {

    /**
     * @constructor
     * @param plot
     */
    sigplot.Layer2D = function(plot) {
        this.plot = plot;

        this.offset = 0.0;
        this.xstart = 0.0;
        this.xdelta = 0.0;
        this.ystart = 0.0;
        this.ydelta = 0.0;
        this.imin = 0;
        this.xmin = 0.0;
        this.xmax = 0.0;
        this.name = "";
        this.cx = false;
        this.hcb = undefined; // index in Gx.HCB

        this.display = true;
        this.color = 0;
        this.line = 3; // 0=none, 1-vertical, 2-horizontal, 3-connecting
        this.thick = 1; // negative for dashed
        this.symbol = 0;
        this.radius = 3;

        this.skip = 0; // number of elements between ord values
        this.xsub = 0;
        this.ysub = 0;
        this.xdata = false; // true if X data is data from file
        this.modified = false;

        this.preferred_origin = 4;
        this.opacity = 1;

        // LPB is kinda odd right now, since we read the entire file into memory anyways...
        // given that often we are loading from an HREF so there is no downside to this...
        // however, we keep LPB around (for now) so that the scaling behaves identical to
        // the original code
        this.lpb = undefined;

        this.yc = 1; // y-compression factor...not yet used 

        this.options = {};
    };

    sigplot.Layer2D.prototype = {

        /**
         * Initializes the layer to display the provided data.
         *
         * @param hcb
         *            {BlueHeader} an opened BlueHeader file
         * @param lyrn
         *          the index of the added layer
         *
         * @memberOf sigplot.Layer2D
         * @private
         */
        init: function(hcb) {
            var Gx = this.plot._Gx;
            var Mx = this.plot._Mx;

            this.hcb = hcb;
            this.hcb.buf_type = "D";

            if (this.hcb.pipe) {
                var self = this;
                this.position = 0;
                this.frame = 0;


                this.lps = Math.ceil(Math.max(1, (Mx.b - Mx.t)));
                m.addPipeWriteListener(this.hcb, function() {
                    self._onpipewrite();
                });
                this.buf = this.hcb.createArray(null, 0, this.lps * this.hcb.subsize * this.hcb.spa);
                this.zbuf = new sigplot.PointArray(this.lps * this.hcb.subsize);
            } else {
                this.lps = Math.ceil(hcb.size);
            }

            this.offset = 0;
            this.xbufn = 0;
            this.ybufn = 0;
            this.drawmode = "scrolling"; // "falling", "rising"


            if (hcb["class"] <= 2) {
                this.xsub = -1;
                this.ysub = 1;
                this.cx = (hcb.format[0] === 'C');
            } else {
                // TODO
            }

            this.skip = 1;
            if (this.cx) {
                this.skip = 2;
            }

            if (Gx.index) {
                this.xstart = 1.0;
                this.xdelta = 1.0;
                this.xmin = 1.0;
                this.xmax = hcb.subsize;
                this.ystart = 1.0;
                this.ydelta = 1.0;
                this.ymin = 1.0;
                this.ymax = this.size;
            } else {
                this.xstart = hcb.xstart;
                this.xdelta = hcb.xdelta;
                var d = hcb.xstart + hcb.xdelta * (hcb.subsize - 1.0);
                this.xmin = Math.min(hcb.xstart, d);
                this.xmax = Math.max(hcb.xstart, d);
                this.ystart = hcb.ystart;
                this.ydelta = hcb.ydelta;
                var d = hcb.ystart + hcb.ydelta * (this.lps - 1.0);
                this.ymin = Math.min(hcb.ystart, d);
                this.ymax = Math.max(hcb.ystart, d);
            }

            // TODO make this work with force 1000 applied
            this.xframe = this.hcb.subsize;
            this.yframe = (this.lps * this.hcb.subsize) / this.xframe;

            if (this.lpb === 0) {
                this.lpb = this.yframe;
            }
            if (!this.lpb || (this.lpb <= 0)) {
                this.lpb = 16;
            }
            this.lpb = Math.max(1, this.lpb / this.yc) * this.yc;

            this.xlab = hcb.xunits;
            this.ylab = hcb.yunits; // might be undefined

        },

        _onpipewrite: function() {
            var Gx = this.plot._Gx;
            var Mx = this.plot._Mx;

            if (m.pavail(this.hcb) < (this.hcb.subsize * this.hcb.spa)) {
                return;
            }

            if (this.drawmode === "falling") {
                this.position = 0;
                this.buf.set(this.buf.subarray(0, (this.lps - 1) * this.hcb.subsize * this.hcb.spa), this.hcb.subsize * this.hcb.spa);
                if (this.img) {
                    mx.shift_image_rows(Mx, this.img, 1);
                }
            } else if (this.drawmode === "rising") {
                this.position = this.lps - 1;
                this.buf.set(this.buf.subarray(this.hcb.subsize * this.hcb.spa), 0);
                if (this.img) {
                    mx.shift_image_rows(Mx, this.img, -1);
                }
            } else if (this.drawmode === "scrolling") {
                if (this.position >= this.lps) { // if lps got resized make sure we don't go out of bounds
                    this.position = 0;
                }
            } else {
                throw "Invalid draw mode";
            }

            var ngot = m.grabx(this.hcb, this.buf, this.hcb.subsize * this.hcb.spa, this.position * this.hcb.subsize * this.hcb.spa);
	    if (ngot === 0) { // shouldn't happen because of the pavail check
                m.log.error("Internal error");
                return;
	    }

            var dbuf = this.buf.subarray(this.position * this.hcb.subsize * this.hcb.spa, (this.position + 1) * this.hcb.subsize * this.hcb.spa);
            var zpoint = new sigplot.PointArray(this.hcb.subsize);
            if (this.cx) {
                if (Gx.cmode === 1) {
                    m.cvmag(dbuf, zpoint, zpoint.length);
                } else if (Gx.cmode === 2) {
                    if (Gx.plab === 25) {
                        m.cvpha(dbuf, zpoint, zpoint.length);
                        m.vsmul(zpoint, 1.0 / (2 * Math.PI), zpoint, zpoint.length);
                    } else if (Gx.plab !== 24) {
                        m.cvpha(dbuf, zpoint, zpoint.length);
                    } else {
                        m.cvphad(dbuf, zpoint, zpoint.length);
                    }
                } else if (Gx.cmode === 3) {
                    m.vmov(dbuf, this.skip, zpoint, 1, zpoint.length);
                } else if (Gx.cmode === 4) {
                    m.vmov(dbuf.subarray(1), this.skip, zpoint, 1, zpoint.length);
                } else if (Gx.cmode === 5) { // IR
                    m.vfill(zpoint, 0, zpoint.length);
                } else if (Gx.cmode === 6) { // 10log
                    m.cvmag2logscale(dbuf, Gx.dbmin, 10.0, zpoint);
                } else if (Gx.cmode === 7) { // 20log
                    m.cvmag2logscale(dbuf, Gx.dbmin, 20.0, zpoint);
                }
            } else {
                if (Gx.cmode === 1) { // mag
                    m.vabs(dbuf, zpoint);
                } else if (Gx.cmode === 2) { // phase
                    m.vfill(zpoint, 0, zpoint.length);
                } else if (Gx.cmode === 3) { // real
                    m.vmov(dbuf, this.skip, zpoint, 1, zpoint.length);
                } else if (Gx.cmode === 4) { // imag
                    m.vfill(zpoint, 0, zpoint.length);
                } else if (Gx.cmode === 5) { // IR
                    m.vfill(zpoint, 0, zpoint.length);
                } else if (Gx.cmode === 6) { // 10log
                    m.vlogscale(dbuf, Gx.dbmin, 10.0, zpoint);
                } else if (Gx.cmode === 7) { // 20log
                    m.vlogscale(dbuf, Gx.dbmin, 20.0, zpoint);
                }
            }

            var min = zpoint[0];
            var max = zpoint[0];
            for (var i = 0; i < zpoint.length; i++) {
                if (zpoint[i] < min) { min = zpoint[i]; }
                if (zpoint[i] > max) { max = zpoint[i]; }
            }

            if (Gx.autol === 1) {
                Gx.zmin = min;
                Gx.zmax = max;
            } else if (Gx.autol > 1) {
                var fac = 1.0 / (Math.max(Gx.autol, 1));
                Gx.zmin = Gx.zmin * fac + min * (1.0 - fac);
                Gx.zmax = Gx.zmax * fac + max * (1.0 - fac);
            }

            if (this.img) {
                mx.update_image_row(Mx, this.img, zpoint, this.position, Gx.zmin, Gx.zmax);
            }
            this.frame += 1;
            if (this.drawmode === "scrolling") {
                this.position = (this.position + 1) % this.lps;
            }
        },

        get_data: function() {
            var HCB = this.hcb;

            if (!this.buf) {
                this.buf = this.hcb.createArray(null, 0, this.lps * this.hcb.subsize * this.hcb.spa);
                this.zbuf = new sigplot.PointArray(this.lps * this.hcb.subsize);
            }

            if (!this.hcb.pipe) {
                m.grab(HCB, this.buf, 0, HCB.subsize);
            }
        },

        /**
         * Provisional API
         *
         * @private
         * @param x
         * @param y
         */
        get_z: function(x, y) {
            var ix = Math.floor(x / this.hcb.xdelta);
            var iy = Math.floor(y / this.hcb.ydelta);
            var zidx = (iy * this.hcb.subsize) + ix;
            return this.zbuf[zidx];
        },

        change_settings: function(settings) {
            var Gx = this.plot._Gx;

            if (settings.cmode !== undefined) {
                this.img = undefined;
                Gx.zmin  = undefined;
                Gx.zmax  = undefined;
            }
            if (settings.cmap !== undefined) {
                this.img = undefined;
            }
            if (settings.drawmode !== undefined) {
                this.drawmode = settings.drawmode;
                // Reset the buffer
                this.position = 0;
                this.frame = 0;
                this.buf = this.hcb.createArray(null, 0, this.lps * this.hcb.subsize * this.hcb.spa);
                this.zbuf = new sigplot.PointArray(this.lps * this.hcb.subsize);
                this.img = undefined;
            }
        },

        push: function(data, hdrmod, sync) {
            if (hdrmod) {
                // TODO handle hcb subsize changes
                
                for (var k in hdrmod) {
                    this.hcb[k] = hdrmod[k];
                }
                      
                var d = this.hcb.xstart + this.hcb.xdelta * (this.hcb.subsize - 1.0);
                this.xmin = Math.min(this.hcb.xstart, d);
                this.xmax = Math.max(this.hcb.xstart, d);
                this.xdelta = this.hcb.xdelta;
                this.xstart = this.hcb.xstart;

                this.ystart = this.hcb.ystart;
                this.ydelta = this.hcb.ydelta;
                var d = this.hcb.ystart + this.hcb.ydelta * (this.lps - 1.0);
                this.ymin = Math.min(this.hcb.ystart, d);
                this.ymax = Math.max(this.hcb.ystart, d);
            }

            m.filad(this.hcb, data, sync);

            return hdrmod ? true : false;
            
        },

        prep: function(xmin, xmax) {
            var Gx = this.plot._Gx;
            var Mx = this.plot._Mx;

            var npts = this.lps;

            var skip = this.skip;

            var qmin = this.xmin;
            var qmax = this.xmax;
            var n1, n2;

            this.get_data(xmin, xmax);

            if ((Gx.cmode === 5) || (this.xsub > 0)) {
                // TODO - is this mode supported in rasters?
            } else if (npts > 0) {
                var xstart = this.xstart;
                var xdelta = this.xdelta;
                var d = npts;
                if (Gx.index) {
                    n1 = 0;
                    n2 = npts - 1;
                } else if (xdelta >= 0.0) {
                    n1 = Math.max(1.0, Math.min(d, Math.round((xmin - xstart) / xdelta))) - 1.0;
                    n2 = Math.max(1.0, Math.min(d, Math.round((xmax - xstart) / xdelta) + 2.0)) - 1.0;
                } else {
                    n1 = Math.max(1.0, Math.min(d, Math.round((xmax - xstart) / xdelta) - 1.0)) - 1.0;
                    n2 = Math.max(1.0, Math.min(d, Math.round((xmin - xstart) / xdelta) + 2.0)) - 1.0;
                }

                npts = n2 - n1 + 1;
                if (npts < 0) {
                    m.log.debug("Nothing to plot");
                    npts = 0;
                }
            }

            if (Gx.panxmin > Gx.panxmax) {
                Gx.panxmin = qmin;
                Gx.panxmax = qmax;
            } else {
                Gx.panxmin = Math.min(Gx.panxmin, qmin);
                Gx.panxmax = Math.max(Gx.panxmax, qmax);
            }

            if (npts <= 0) {
		m.log.debug("Nothing to plot");
                return;
            }

            if ((Gx.cmode === 5) || (this.ysub > 0)) {
                // TODO - is this mode supported in rasters?
            } else if (npts > 0) {
                var ystart = this.ystart;
                var ydelta = this.ydelta;
                var d = npts;
                if (Gx.index) {
                    n1 = 0;
                    n2 = npts - 1;
                } else if (ydelta >= 0.0) {
                    n1 = Math.max(1.0, Math.min(d, Math.round((xmin - ystart) / ydelta))) - 1.0;
                    n2 = Math.max(1.0, Math.min(d, Math.round((xmax - ystart) / ydelta) + 2.0)) - 1.0;
                } else {
                    n1 = Math.max(1.0, Math.min(d, Math.round((xmax - ystart) / ydelta) - 1.0)) - 1.0;
                    n2 = Math.max(1.0, Math.min(d, Math.round((xmin - ystart) / ydelta) + 2.0)) - 1.0;
                }

                npts = n2 - n1 + 1;
                if (npts < 0) {
                    m.log.debug("Nothing to plot");
                    npts = 0;
                }
            }

            if (Gx.panymin > Gx.panxmax) {
                Gx.panymin = this.ymin;
                Gx.panymax = this.ymax;
            } else {
                Gx.panymin = Math.min(Gx.panymin, this.ymin);
                Gx.panymax = Math.max(Gx.panymax, this.ymax);
            }

            if (this.cx) {
                if (Gx.cmode === 1) { // mag
                    m.cvmag(this.buf, this.zbuf, this.zbuf.length);
                } else if (Gx.cmode === 2) { // phase
                    if (Gx.plab === 25) {
                        m.cvpha(this.buf, this.zbuf, this.zbuf.length);
                        m.vsmul(this.zbuf, 1.0 / (2 * Math.PI), this.zbuf, this.zbuf.length);
                    } else if (Gx.plab !== 24) {
                        m.cvpha(this.buf, this.zbuf, this.zbuf.length);
                    } else {
                        m.cvphad(this.buf, this.zbuf, this.zbuf.length);
                    }
                } else if (Gx.cmode === 3) { // real
                    m.vmov(this.buf, this.skip, this.zbuf, 1, this.zbuf.length);
                } else if (Gx.cmode === 4) { // imag
                    m.vmov(this.buf.subarray(1), this.skip, this.zbuf, 1, this.zbuf.length);
                } else if (Gx.cmode === 5) { // IR - what does this mean for a raster?
                    m.vfill(this.zbuf, 0, this.zbuf.length);
                } else if (Gx.cmode === 6) { // 10log
                    m.cvmag2logscale(this.buf, Gx.dbmin, 10.0, this.zbuf);
                } else if (Gx.cmode === 7) { // 20log
                    m.cvmag2logscale(this.buf, Gx.dbmin, 20.0, this.zbuf);
                }
            } else {
                if (Gx.cmode === 1) { // mag
                    m.vabs(this.buf, this.zbuf);
                } else if (Gx.cmode === 2) { // phase
                    m.vfill(this.zbuf, 0, this.zbuf.length);
                } else if (Gx.cmode === 3) { // real
                    m.vmov(this.buf, this.skip, this.zbuf, 1, this.zbuf.length);
                } else if (Gx.cmode === 4) { // imag
                    m.vfill(this.zbuf, 0, this.zbuf.length);
                } else if (Gx.cmode === 5) { // IR
                    m.vfill(this.zbuf, 0, this.zbuf.length);
                } else if (Gx.cmode === 6) { // 10log
                    m.vlogscale(this.buf, Gx.dbmin, 10.0, this.zbuf);
                } else if (Gx.cmode === 7) { // 20log
                    m.vlogscale(this.buf, Gx.dbmin, 20.0, this.zbuf);
                }
            }

            // find z-min/z-max
            // this is equivalent to setting XRASTER /LPB=0
            var zpoint = this.zbuf;
            if (this.hcb.pipe && (this.frame < this.lps)) {
                if (this.drawmode === "rising") {
                    zpoint = this.zbuf.subarray(this.zbuf.length-(this.frame*this.hcb.subsize));
                } else {
                    zpoint = this.zbuf.subarray(0,this.frame*this.hcb.subsize);
                }
            }

            var min = 0;
            var max = 0;
            if (zpoint.length > 0) {
                min = zpoint[0];
                max = zpoint[0];
                for (var i = 0; i < zpoint.length; i++) {
                    if ((i / this.xframe) >= this.lpb) { break; }
                    if (zpoint[i] < min) { min = zpoint[i]; }
                    if (zpoint[i] > max) { max = zpoint[i]; }
                }
            }

            if (Gx.zmin !== undefined) {
                Gx.zmin = Math.min(Gx.zmin, min);
            } else {
                Gx.zmin = min;
            }
            if (Gx.zmax !== undefined) {
                Gx.zmax = Math.min(Gx.zmax, max);
            } else {
                Gx.zmax = max;
            }

            this.img = mx.create_image(Mx, this.zbuf, this.hcb.subsize, this.lps, Gx.zmin, Gx.zmax);
            this.img.cmode = Gx.cmode;
            this.img.cmap = Gx.cmap;
            this.img.origin = Mx.origin;
           
            // Make the parts without data transparent 
            if (this.hcb.pipe && (this.frame < this.lps)) {
                var imgd = new Uint32Array(this.img);
                if (this.drawmode === "rising") {
                    for (var i=0; i<imgd.length-(this.frame*this.hcb.subsize); i++) {
                        imgd[i] = 0;
                    }
                } else {
                    for (var i=this.frame * this.hcb.subsize; i<imgd.length; i++) {
                        imgd[i] = 0;
                    }
                }
            }

            return npts;
        },

        draw: function() {
            var Mx = this.plot._Mx;
            var Gx = this.plot._Gx;
            var HCB = this.hcb;

            if (this.hcb.pipe) {
                var lps = Math.ceil(Math.max(1, (Mx.b - Mx.t)));
                if ((lps !== this.lps) && this.buf) {
                    var new_buf = this.hcb.createArray(null, 0, lps * this.hcb.subsize * this.hcb.spa);
                    var new_zbuf = new sigplot.PointArray(lps * this.hcb.subsize);

                    // copy the data into the new buffer, it will be clamped by subarray
                    new_buf.set(this.buf.subarray(0, new_buf.length));
                    new_zbuf.set(this.zbuf.subarray(0, new_zbuf.length));
                    this.buf = new_buf;
                    this.zbuf = new_zbuf;
                    this.lps = lps;
		    if (this.position >= this.lps) { // if lps got resized make sure we don't go out of bounds
			this.position = 0;
		    }
                    var d = HCB.ystart + HCB.ydelta * (this.lps - 1.0);
                    this.ymin = Math.min(HCB.ystart, d);
                    this.ymax = Math.max(HCB.ystart, d);
                    this.plot.rescale();
                }
            }

            var xmin = Math.max(this.xmin, Mx.stk[Mx.level].xmin);
            var xmax = Math.min(this.xmax, Mx.stk[Mx.level].xmax);
            if (xmin >= xmax) { // no data but do scaling
                Gx.panxmin = Math.min(Gx.panxmin, this.xmin);
                Gx.panxmax = Math.max(Gx.panxmax, this.xmax);
                return;
            }
            var ymin = Math.max(this.ymin, Mx.stk[Mx.level].ymin);
            var ymax = Math.min(this.ymax, Mx.stk[Mx.level].ymax);

            var w = Math.abs(xmax - xmin) + 1;
            var h = Math.abs(ymax - ymin) + 1;

            w = Math.floor(w / HCB.xdelta);
            h = Math.floor(h / HCB.ydelta);

            w = Math.min(w, HCB.subsize);
            h = Math.min(h, HCB.size);

            var ul = mx.real_to_pixel(Mx, xmin, ymin);
            var lr = mx.real_to_pixel(Mx, xmax, ymax);

            var iw = lr.x - ul.x;
            var ih = lr.y - ul.y;

            var rx = iw / w;
            var ry = ih / h;

            Gx.xe = Math.max(1, Math.round(rx));
            Gx.ye = Math.max(1, Math.round(ry));

            if (!this.img) {
                this.prep(xmin, xmax);
            } else if ((Gx.cmode !== this.img.cmode) || (Gx.cmap !== this.img.cmap) || (Mx.origin !== this.img.origin)) {
                this.prep(xmin, xmax);
            }

            if (this.img) {
                mx.draw_image(Mx, this.img, this.xmin, this.ymin, this.xmax, this.ymax, this.opacity, Gx.rasterSmoothing);
            }

            if (this.position) {
                var pnt = mx.real_to_pixel(Mx, 0, this.position*this.ydelta);
                if ((pnt.y > Mx.t) && (pnt.y < Mx.b)) {
                    mx.draw_line(Mx, "white", Mx.l, pnt.y, Mx.r, pnt.y);
                }
            }
        }
    };

    /**
     * Factory to overlay the given file onto the given plot.
     *
     * @private
     */
    sigplot.Layer2D.overlay = function(plot, hcb, layerOptions) {
        var Gx = plot._Gx;
        var Mx = plot._Mx;

        hcb.buf_type = "D";

        var layer = new sigplot.Layer2D(plot);
        layer.init(hcb);

        if (hcb.file_name) {
            layer.name = m.trim_name(hcb.file_name);
        } else {
            layer.name = "layer_" + Gx.lyr.length;
        }

        for (var layerOption in layerOptions) {
            if (layer[layerOption] !== undefined) {
                layer[layerOption] = layerOptions[layerOption];
            }
        }

        plot.add_layer(layer);
    };

}(window.sigplot = window.sigplot || {}, mx, m));

/**
 * @license
 * File: sigplot.js
 * Copyright (c) 2012-2014, Michael Ihde, All rights reserved.
 * Copyright (c) 2012-2014, Axios Inc., All rights reserved.
 *
 * This file is part of SigPlot.
 *
 * SigPlot is free software; you can redistribute it and/or modify it under the terms of the GNU Lesser
 * General Public License as published by the Free Software Foundation; either version 3.0 of the License, or
 * (at your option) any later version. This library is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE. See the GNU Lesser General Public License for more details. You should have received a copy of the
 * GNU Lesser General Public License along with SigPlot.
 */

/*jslint nomen: true, browser: true, devel: true */

/**
 * This namespace provides the implementation of the plotting functionality.
 *
 * @namespace sigplot
 */
window.sigplot = window.sigplot || {};

//Uses Immediately-invoked Function Expressions (IIFE)s for namespaces
//See:
//http://addyosmani.com/blog/essential-js-namespacing/ for details.
//http://www.ethangardner.com/articles/javascript-namespace-strategy-for-large-applications/
(function(sigplot, mx, m) {
    /* global setKeypressHandler */
    /* global getKeyCode */
    /* global BlueFileReader */
    /* global Spinner */

    /**
     * Text of the keypress help dialog.
     *
     * @memberOf sigplot
     * @private
     */
    var KEYPRESS_HELP = "Keypress Table:\n" + "--------------\n" + "?    - Main help box.\n" + "A    - Toggle display x,y readouts:\n" + "       (absc) -> (index) -> (1/absc) -> (time).\n" + "B    - Toggle LM Drag Mode:\n" + "       (box) -> (horizontal) -> (vertical).\n" + "C    - Toggle controls.\n" + "L    - Toggle legend.\n" + "M    - Pops up main menu\n" + "R    - Toggle display specs (x/y readout)\n" + "S    - Toggle display specs and axes.\n" + "T    - Popup box with timecode value at mouse.\n" + "X    - Popup box with X value at mouse.\n" + "Y    - Popup box with Y value at mouse.\n" + "F    - Toggle fullscreen.\n";

    /**
     * Text of the main help dialog.
     *
     * @memberOf sigplot
     * @private
     */
    var MAIN_HELP = "To zoom, press and drag the left mouse (LM) over the region of interest and release. " + "To unzoom, press right mouse (RM).  Press the middle mouse (MM) button or press the " + "key 'M' to bring up the menu.  Information about keypresses and what they do can be found" + "by selecting 'Keypress Info' from the main menu.";

    /**
     * Attempts basic checks to determine if the browser is compatible with
     * sigplot.
     *
     * @memberOf sigplot
     * @private
     */
    sigplot.browserIsCompatible = function browserIsCompatible() {
        // We need a Canvas
        var test_canvas = document.createElement('canvas');
        var hascanvas = (test_canvas.getContext) ? true : false;

        // We need ArrayBuffer
        var hasarraybuf = ("ArrayBuffer" in window);

        // File and FileReader are optional...and only
        // required if the user wants to plot local files
        return (hascanvas && hasarraybuf);
    };

    /**
     *
     *
     * @memberOf sigplot
     * @private
     */
    var PointArray = null;

    /**
     * True if we detected that we are on an iOS device
     *
     * @memberOf sigplot
     * @private
     */
    var iOS = (navigator.userAgent.match(/(iPad|iPhone|iPod)/i) ? true : false);
    if ((iOS) ||                                   // iOS doesn't support Float64
	(typeof Float64Array === 'undefined') ||   // If it's undefined it's obviously not supported
	(Float64Array.emulated) ||                 // If it's emulated, don't waste time on extra precision
	(!Float64Array.BYTES_PER_ELEMENT)) {       // If bytes per element isn't defined, it's a buggy implementation (i.e. PhantomJS)
        sigplot.PointArray = Float32Array;
    } else {
        sigplot.PointArray = Float64Array;
    }



    /**
     * Construct and render a plot.
     *
     * @constructor
     *
     * @example plot = new sigplot.Plot(document.getElementById('plot'), {});
     *
     * @param element
     *            a 'div' DOM elements
     * @param [options]
     *            alters the behavior of the plot.
     *
     * @param {String}
     *            options.cmode the plot rendering mode "IN" = Index, "AB" =
     *            Abscissa, "MA" = Magnitude, "PH" = Phase, "RE" = Real, "IM" =
     *            Imaginary, "LO" or "D1" = 10*log, "L2" or "D2" = 20*log, "RI"
     *            or "IR" = Real vs. Imaginary
     *
     * @param {String}
     *            options.phunits the phase units "D" = Degrees, "R" = Radians,
     *            "C" = Cycles
     *
     * @param {Boolean}
     *            options.cross display cross hairs on the plot
     *
     * @param {Boolean}
     *            options.nogrid hide the background grid
     *
     * @param {Boolean}
     *            options.legend hide the legned
     *
     * @param {Boolean}
     *            options.nopan disable panning on the plot
     *
     * @param {Boolean}
     *            options.nomenu disable the middle-click menu
     *
     * @param {Boolean}
     *            options.nospec hide all plot specification displays
     *
     * @param {Boolean}
     *            options.noxaxis hide the x-axis
     *
     * @param {Boolean}
     *            options.noyaxis hide the y-axis
     *
     * @param {Boolean}
     *            options.noreadout hide the plot readout area
     *
     * @param {Boolean}
     *            options.nodragdrop prevent file drag drop
     *
     * @param {Number}
     *            options.scroll_time_interval
     *
     * @param {Boolean}
     *            options.index use the data-index in the X axis
     *
     * @param {Number}
     *            options.autox auto-scaling settings for X axis
     *
     * @param {Number}
     *            options.xmin the minimum range to display on the X axis
     *
     * @param {Number}
     *            options.xmax the maximum range to display on the X axis
     *
     * @param {Number}
     *            options.xlab the units that X-axis uses (see m.UNITS)
     *
     * @param {Number}
     *            options.xdiv the number of divisions on the X axis
     *
     * @param {Number}
     *            options.xcnt configure the mtag mouse controls 0 = Off, 1
     *            (default) = LM Click, 2 = Continuous
     *
     * @param {String}
     *            options.rubberbox_mode controls the behavior of the rubberbox
     *            "zoom" (default) = zoom to the selected area "box" = trigger
     *            an mtag action on the selected area
     *
     * @param {Number}
     *            options.line the line type to draw 0 = None, 1 = Verticals, 2 =
     *            Horizontals, 3 (default) = Connecting
     *
     * @param {Number}
     *            options.autoy auto-scaling settings for Y axis
     *
     * @param {Number}
     *            options.ylab the units that Y-axis uses (see m.UNITS)
     *
     * @param {Number}
     *            options.ymin the minimum range to display on the Y axis
     *
     * @param {Number}
     *            options.ymax the maximum range to display on the Y axis
     *
     * @param {Number}
     *            options.ydiv the number of divisions on the Y axis
     *
     * @param {Boolean}
     *            options.yinv invert the y-axis
     *
     * @param {String}
     *            options.colors.fg the foreground color as a CSS color
     *
     * @param {String}
     *            options.colors.bg the background color as a CSS color
     *
     * @param {Boolean}
     *            options.xi invert the foreground/background colors
     *
     * @param {Boolean}
     *            options.forcelab
     *
     * @param {Boolean}
     *            options.all show all of the data on the plot instead of just
     *            one buffer
     *
     * @param {Boolean}
     *            options.expand auto-scale the plot based on all the data (when
     *            combined with the all option)
     *
     * @param {Number}
     *            options.origin 1 = x1:xmin, x2:xmax, y1:ymax, y2:ymin
     *            (default), 2 = x1:xmax, x2:xmin, y1:ymax, y2:ymin (x
     *            inverted), 3 = x1:xmax, x2:xmin, y1:ymin, y2:ymax (x & y
     *            inverted), 4 = x1:xmin, x2:xmax, y1:ymin, y2:ymax (y inverted)
     *
     * @param {Number}
     *            options.bufmax the buffer size to use
     *
     * @param {Boolean}
     *            options.nokeypress disable key press actions
     *
     * @param options.anno_type
     *            (Not implemented)
     *
     * @param options.pmt
     *            (Not implemented)
     *
     * @param options.xfmt
     *            (Not implemented)
     *
     * @param options.yfmt
     *            (Not implemented)
     *
     * @param options.nsec
     *            the number of sections to split the plot into (Not
     *            implemented)
     *
     * @returns {sigplot.Plot}
     */
    sigplot.Plot = function(element, options) {
        if (!sigplot.browserIsCompatible()) {
            throw "Browser is not compatible";
        }

        // Register with the Mx structure - Step #4
        this._Mx = mx.open(element);
        var Mx = this._Mx;

        this._Gx = new GX();
        this._Gx.parent = element;

        // Variable which stores state of mouse position relative to the canvas
        this.mouseOnCanvas = false;

        if (!options) {
            options = {};
        }

        plot_init(this, options);

        this._refresh(); // Draw immediately

        this.onmousemove = (function(plot) {
            return function(e) {
                var Mx = plot._Mx;
                var Gx = plot._Gx;

                var rect = e.target.getBoundingClientRect();
                var xpos = (e.offsetX === undefined) ? (e.pageX - rect.left - window.scrollX) : e.offsetX;
                var ypos = (e.offsetX === undefined) ? (e.pageY - rect.top - window.scrollY) : e.offsetY;

                // var xpos = (e.offsetX === undefined) ? e.layerX : e.offsetX;
                // var ypos = (e.offsetY === undefined) ? e.layerY : e.offsetY;
                var re = pixel_to_real(plot, xpos, ypos);
                Gx.retx = re.x;
                Gx.rety = re.y;

                if (Mx.widget) {
                    return;
                }
                display_specs(plot);

                var evt = document.createEvent('Event');
                evt.initEvent('mmove', true, true);
                evt.xpos = xpos;
                evt.ypos = ypos;
                evt.x = Gx.retx;
                evt.y = Gx.rety;
                var canceled = !mx.dispatchEvent(Mx, evt);
                if (canceled) {
                    return;
                }

                // The crosshair logic in websigplot is different
                // because we need to clear the previous position
                // of the line (via XOR) and then draw the new line
                //
                // The Mx.xpos and Mx.ypos may have already been
                // updated to their new location so we need to store
                // the crosshair position in the Gx structure
                if (Gx.cross) {
                    if (Mx.warpbox) {
                        // during zoom operations undraw the crosshairs
                        if (Gx.cross_xpos !== undefined) {
                            mx.rubberline(Mx, Gx.cross_xpos, Mx.t,
                                Gx.cross_xpos, Mx.b);
                        }
                        if (Gx.cross_ypos !== undefined) {
                            mx.rubberline(Mx, Mx.l, Gx.cross_ypos, Mx.r,
                                Gx.cross_ypos);
                        }
                        Gx.cross_xpos = undefined;
                        Gx.cross_ypos = undefined;
                    } else {
                        draw_crosshairs(plot);
                    }
                }

                if (Gx.cntrls === 2) {
                    var evt = document.createEvent('Event');
                    evt.initEvent('mtag', true, true);
                    evt.x = Gx.retx;
                    evt.y = Gx.rety;
                    mx.dispatchEvent(Mx, evt);
                }
            };
        }(this));

        this.ontouchmove = (function(plot) {
            return function(event) {
                event.preventDefault();
                plot.onmousemove(event);
            };
        }(this));

        this.throttledOnMouseMove = m.throttle(this._Gx.scroll_time_interval,
            this.onmousemove);

        mx.addEventListener(Mx, "mousemove", this.throttledOnMouseMove, false);
        // canvas.addEventListener('touchmove', this.ontouchmove, false);

        this.onmouseout = (function(plot) {
            return function(event) {
                var Gx = plot._Gx;
                var Mx = plot._Mx;
                if (plot.mouseOnCanvas) {
                    plot.mouseOnCanvas = false;

                    if (Gx.autohide_readout) {
                        display_specs(plot);
                    }
                    if (Gx.autohide_panbars) {
                        draw_panbars(plot);
                    }
                    if (Mx.prompt) {
                        Mx.prompt.input.enableBlur();
                    }
                }
            };
        }(this));
        mx.addEventListener(Mx, "mouseout", this.onmouseout, false);

        this.onmouseover = (function(plot) {
            return function(event) {
                var Gx = plot._Gx;
                var Mx = plot._Mx;
                plot.mouseOnCanvas = true;
                if (Gx.autohide_panbars) {
                    draw_panbars(plot);
                }
                if (Mx.prompt) {
                    Mx.prompt.input.disableBlur();
                }
            };
        }(this));
        mx.addEventListener(Mx, "mouseover", this.onmouseover, false);

        this.onmousedown = (function(plot) {
            return function(event) {
                event.preventDefault(); // mouse down on the canvas should never do a browser default action

                var Mx = plot._Mx;
                var Gx = plot._Gx;

                if (Mx.widget && (Mx.widget.type === "ONESHOT")) {
                    Mx.widget = null;
                    plot.refresh();
                }

                // Update Mx event fields
                mx.ifevent(Mx, event);

                var evt = document.createEvent('Event');
                evt.initEvent('mdown', true, true);
                evt.xpos = Mx.xpos;
                evt.ypos = Mx.ypos;
                evt.x = Gx.retx;
                evt.y = Gx.rety;
                evt.which = event.which;
                var canceled = !mx.dispatchEvent(Mx, evt);
                if (canceled) {
                    return false;
                }

                // Check if event occured in the pan region
                var inPan = inPanRegion(plot);

                // Event processing
                if (inPan.inPanRegion) { // Mouse position lies in a pan
                    // region
                    event.preventDefault();
                    if (inPan.command !== ' ') {
                        var scrollbar = null;
                        var position = null;
                        if (inPan.command === "XPAN") {
                            scrollbar = Mx.scrollbar_x;
                        } else if (inPan.command === "YPAN") {
                            scrollbar = Mx.scrollbar_y;
                        }

                        if (event.which === 2) {
                            position = {
                                x: Mx.xpos,
                                y: Mx.ypos
                            };
                            if ((scrollbar !== undefined) && (onScrollbar(position, scrollbar))) {
                                // Only show menu if on the scrollbar itself
                                sigplot_scrollScaleMenu(plot, inPan.command);
                            }
                        } else {
                            if (inPan.command !== ' ') {
                                position = {
                                    x: Mx.xpos,
                                    y: Mx.ypos
                                };
                                if (!onScrollbar(position, scrollbar) && event.which === 1) { // Left-clicking
                                    // not on a
                                    // scrollbar -
                                    // handle
                                    // typical pan
                                    pan(plot, inPan.command, 0, event); // Execute
                                    // the
                                    // first
                                    // pan
                                    var repeatPan = function() {
                                        if (!onScrollbar({
                                            "x": Mx.xpos,
                                            "y": Mx.ypos
                                        }, scrollbar)) {
                                            pan(plot, inPan.command, 0, event);
                                            // execute
                                            // a
                                            // pan
                                            // on
                                            // every
                                            // interval
                                        } else {
                                            // stop
                                            // panning
                                            // once you
                                            // hit the
                                            // scrollbar
                                            if (Gx.stillPanning) {
                                                window.clearInterval(Gx.stillPanning);
                                                Gx.repeatPanning = undefined;
                                            }
                                        }
                                    };

                                    // Make scrolling smooth, the longer initial prevents
                                    // a single click from counting twice
                                    Gx.stillPanning = window.setTimeout(
                                        function() {
                                            Gx.repeatPanning = window.setInterval(repeatPan, 50);
                                        }, 250);
                                }
                            }
                        }
                    }
                } else { // Mouse not in a pan region, handle other cases
                    if (event.which === 1) {
                        var lButtonPressed = coordsInRectangle(Mx.xpos,
                            Mx.ypos, Gx.legendBtnLocation.x,
                            Gx.legendBtnLocation.y,
                            Gx.legendBtnLocation.width,
                            Gx.legendBtnLocation.height);

                        if (lButtonPressed) {
                            plot.change_settings({
                                legend: !Gx.legend
                            }); // toggle the legend
                        } else {
                            // In normal sigplot a mark is not set when drawing a
                            // box
                            // but it seems useful to have the specs dx and dy
                            // show you
                            // how big your zoom box is...so this implementation
                            // sets the
                            // mark on mousedown....
                            //
                            // TODO - reset the marks to their original values
                            // after the zoom is complete
                            Gx.xmrk = Gx.retx;
                            Gx.ymrk = Gx.rety;
                            display_specs(plot);

                            // Styles for rubberbox
                            var zoom_style = {
                                opacity: 0,
                                return_value: "zoom"
                            };

                            var select_style = {
                                opacity: 0.4,
                                fill_color: Mx.hi,
                                return_value: "select"
                            };

                            if (Gx.default_rubberbox_action === "zoom") {
                                mx.rubberbox(Mx, rubberbox_cb(plot),
                                    Gx.default_rubberbox_mode, zoom_style,
                                    select_style);
                            } else if (Gx.default_rubberbox_action === "select") {
                                mx.rubberbox(Mx, rubberbox_cb(plot),
                                    Gx.default_rubberbox_mode,
                                    select_style, zoom_style);
                            } // otherwise rubber-box is considered disabled
                        }
                    } else if (event.which === 2) {
                        if (!Gx.nomenu) {
                            sigplot_mainmenu(plot);
                        }
                    } // else if (event.which === 3) {
                    // Nothing yet
                    //}
                }
                return false;
            };
        }(this));

        this.ontouchstart = (function(plot) {
            return function(event) {
                event.preventDefault();
                plot.onmousedown({
                    which: 1
                });
            };
        }(this));

        mx.addEventListener(Mx, "mousedown", this.onmousedown, false);
        // canvas.addEventListener("touchstart", this.ontouchstart, false);

        this.docMouseUp = (function(plot) {
            return function(event) {
                var Gx = plot._Gx;

                if (event.which === 1) {
                    // in general, you shouldn't put anything in here
                    // ...instead it should go into rubberbox_cb
                    Gx.panning = undefined;
                    plot._Mx.scrollbar_x.action = 0; // TODO Is this
                    // necessary?
                    plot._Mx.scrollbar_y.action = 0;
                } //else if (event.which === 2) {
                // nothing
                //} else if (event.which === 3) {
                // nothing
                //}
                if (Gx.stillPanning) {
                    window.clearTimeout(Gx.stillPanning);
                    Gx.stillPanning = undefined;
                }
                if (Gx.repeatPanning) { // Clear the panning interval on any
                    // mouse up in the document
                    window.clearInterval(Gx.repeatPanning);
                    Gx.repeatPanning = undefined;
                }
                return false;
            };
        }(this));
        document.addEventListener("mouseup", this.docMouseUp, false);

        this.mouseup = (function(plot) {
            return function(event) {
                event.preventDefault(); // mouse down on the canvas should never do a browser default action

                var Gx = plot._Gx;
                var Mx = plot._Mx;

                // Update Mx event fields
                mx.ifevent(plot._Mx, event);

                var evt = document.createEvent('Event');
                evt.initEvent('mup', true, true);
                evt.xpos = Mx.xpos;
                evt.ypos = Mx.ypos;
                evt.x = Gx.retx;
                evt.y = Gx.rety;
                evt.which = event.which;
                var canceled = !mx.dispatchEvent(Mx, evt);
                if (!canceled) {
                    if (event.which === 3) { // unzoom only happens on
                        // right-clicks on plot
                        // unzoom/expand
                        event.preventDefault();

                        plot.unzoom(1);
                        plot.refresh();
                    } else if (event.which === 2) {
                        if (Gx.nomenu) {
                            // Send an event so that a custom menu can be displayed
                            // if desired
                            var evt = document.createEvent('Event');
                            evt.initEvent('showmenu', true, true);
                            evt.x = event.x || event.clientX;
                            evt.y = event.y || event.clientY;
                            var cancelled = !mx.dispatchEvent(Mx, evt);

                            if (!cancelled) {
                                if (event.stopPropagation) {
                                    event.stopPropagation();
                                }
                                event.cancelBubble = true;
                                mx.removeEventListener(Mx, "mousedown", plot.onmousedown, false);

                                var emit_hidemenu = function() {
                                    try {
                                        var hideMenuEvt = document.createEvent('Event');
                                        hideMenuEvt.initEvent('hidemenu', true, true);
                                        if (mx.dispatchEvent(Mx, hideMenuEvt)) {
                                            mx.addEventListener(Mx, "mousedown", plot.onmousedown, false);
                                        }
                                    } finally {
                                        document.removeEventListener("mouseup", emit_hidemenu, false);
                                    }
                                };
                                document.addEventListener("mouseup", emit_hidemenu, false);
                            }
                        }
                    }
                }

            };
        }(this));

        this.ontouchend = (function(plot) {
            return function(event) {
                event.preventDefault();
                //
            };
        }(this));

        mx.addEventListener(Mx, "mouseup", this.mouseup, false);
        // canvas.addEventListener("touchstart", this.ontouchend, false);

        this.mouseclick = (function(plot) {
            return function(event) {
                event.preventDefault(); // alway prevent any default browser actions on the plot

                var Gx = plot._Gx;
                var Mx = plot._Mx;

                // Update Mx event fields
                mx.ifevent(plot._Mx, event);

                var evt = document.createEvent('Event');
                evt.initEvent('mclick', true, true);
                evt.xpos = Mx.xpos;
                evt.ypos = Mx.ypos;
                evt.x = Gx.retx;
                evt.y = Gx.rety;
                evt.which = event.which; // not always available on all browser
                if (mx.dispatchEvent(Mx, evt)) {
                    // currently there isn't a default for mouseclick to cancel
                }
                return false;
            };
        }(this));
        mx.addEventListener(Mx, "click", this.mouseclick, false);

        this.mousedblclick = (function(plot) {
            return function(event) {
                event.preventDefault(); // alway prevent any default browser actions on the plot

                var Gx = plot._Gx;
                var Mx = plot._Mx;

                // Update Mx event fields
                mx.ifevent(plot._Mx, event);

                var evt = document.createEvent('Event');
                evt.initEvent('mdblclick', true, true);
                evt.xpos = Mx.xpos;
                evt.ypos = Mx.ypos;
                evt.x = Gx.retx;
                evt.y = Gx.rety;
                evt.which = event.which; // not always available on all browser
                if (mx.dispatchEvent(Mx, evt)) {
                    // currently there isn't a default for mouseclick to cancel
                }
                return false;
            };
        }(this));
        mx.addEventListener(Mx, "dblclick", this.mousedblclick, false);

        // PANBAR DRAGGING mouse event handlers:
        this.dragMouseDownHandler = (function(plot) {
            return function(event) {
                var Mx = plot._Mx;
                var Gx = plot._Gx;

                // Check if event occured in the pan region
                var inPan = inPanRegion(plot);

                // Event processing
                if (inPan.inPanRegion) { // Mouse position lies in a pan
                    // region
                    event.preventDefault();
                    if (inPan.command !== ' ') {
                        var scrollbar;
                        if (inPan.command === "XPAN") {
                            scrollbar = Mx.scrollbar_x;
                        } else if (inPan.command === "YPAN") {
                            scrollbar = Mx.scrollbar_y;
                        }

                        var position = {
                            x: Mx.xpos,
                            y: Mx.ypos
                        };
                        if (scrollbar !== undefined && onScrollbar(position, scrollbar) && event.which === 1) { // On scrollbar, set up
                            // a DRAG
                            Gx.panning = {
                                axis: inPan.command,
                                xpos: event.screenX, // Use screen-relative
                                // values here instead
                                // of div/page-relative
                                // values
                                ypos: event.screenY,
                                xmin: Mx.stk[Mx.level].xmin,
                                xmax: Mx.stk[Mx.level].xmax,
                                ymin: Mx.stk[Mx.level].ymin,
                                ymax: Mx.stk[Mx.level].ymax
                            };
                        }
                    }
                }
            };
        }(this));
        window.addEventListener("mousedown", this.dragMouseDownHandler, false);

        this.dragMouseMoveHandler = (function(plot) {
            return function(e) {
                var Gx = plot._Gx;

                if (Gx.panning !== undefined) { // execute a scrollbar DRAG
                    try {
                        drag_scrollbar(plot, Gx.panning.axis, e);
                    } catch (err) {
                        console.log("Error: " + err); // TODO Eventually come
                        // up with better error
                        // handling here
                    }
                }
            };
        }(this));

        this.throttledDragOnMouseMove = m.throttle(this._Gx.scroll_time_interval,
            this.dragMouseMoveHandler);

        window.addEventListener("mousemove", this.throttledDragOnMouseMove,
            false);

        this.dragMouseUpHandler = (function(plot) {
            return function(event) {
                var Gx = plot._Gx;

                if (event.which === 1) {
                    Gx.panning = undefined; // Panbar dragging completed - clear
                    // the state variable
                }
            };
        }(this));
        window.addEventListener("mouseup", this.dragMouseUpHandler, false);

        // TODO this may need to be throttled or debounced
        this.onresize = (function(plot) {
            return function(event) {
                if (mx.checkresize(plot._Mx)) {
                    plot.refresh();
                }
            };
        }(this));

        // Mouse Wheel logic
        this.wheelHandler = (function(plot) {

            var Mx = plot._Mx;
            var Gx = plot._Gx;

            var throttledPan = m.throttle(100, function(inPan) {
                // Mouse wheel
                // event over a
                // panning
                // region

                var scrollbar;
                if (inPan.command === "XPAN") {
                    scrollbar = Mx.scrollbar_x;
                } else if (inPan.command === "YPAN") {
                    scrollbar = Mx.scrollbar_y;
                }

                // For now, vertical mouse scrolling is the only action that
                // will trigger a pan
                // Later, we can add horizontal mouse scrolling if we choose
                if (Gx.wheelscroll_mode_natural) { // Original Sig-Plot
                    // orientation
                    scrollbar.action = (event.deltaY < 0 ? mx.SB_WHEELDOWN : mx.SB_WHEELUP);
                } else { // Inverted/"un-natural" orientation
                    scrollbar.action = (event.deltaY < 0 ? mx.SB_WHEELUP : mx.SB_WHEELDOWN);
                }

                scrollbar.step = 0.1 * scrollbar.srange;
                scrollbar.page = 9 * scrollbar.step;

                // Execute wheel action on the scrollbar
                mx.scroll(Mx, scrollbar, mx.XW_COMMAND, undefined,
                    scrollbar);

                // Update the viewbox
                updateViewbox(plot, scrollbar.smin, scrollbar.smin + scrollbar.srange, inPan.command.slice(0, 1));
            });

            var throttledZoom = m.throttle(100, function() {
                var zoomperc = Gx.wheelZoomPercent || 0.2;
                if (Gx.wheelscroll_mode_natural) {
                    if (event.deltaY > 0) {
                        zoomperc = -1 * zoomperc;
                    }
                } else { // Inverted/"un-natural" orientation
                    if (event.deltaY < 0) {
                        zoomperc = -1 * zoomperc;
                    }
                }

                if (Gx.wheelZoom === "x") {
                    plot.percent_zoom(zoomperc, 1, true);
                } else if (Gx.wheelZoom === "y") {
                    plot.percent_zoom(1, zoomperc, true);
                } else {
                    plot.percent_zoom(zoomperc, zoomperc, true);
                }
            });

            return function(event) {
                // Update Mx event fields
                mx.ifevent(Mx, event);

                // Check if event occured in the pan region
                var inPan = inPanRegion(plot);

                // Event processing
                if (plot.mouseOnCanvas) {
                    event.preventDefault();

                    if (inPan.inPanRegion) {
                        throttledPan(inPan);
                    } else if (Gx.wheelZoom) {
                        throttledZoom();
                    }
                }
            };
        }(this));

        window.addWheelListener(window, this.wheelHandler, false);

        window.addEventListener("resize", this.onresize, false);

        // If multiple plots are in the same window, then it
        // may be desired to disable keypress behavior and implement
        // it at a higher-level...by default keypress behavior
        // is enabled and only works if the mouse if over the plot
        if (!options.nokeypress) {
            this.onkeypress = (function(plot) {
                return function(event) {
                    var Mx = plot._Mx;
                    var Gx = plot._Gx;
                    if (plot.mouseOnCanvas) {

                        if (Mx.widget && (Mx.widget.type === "MENU")) {
                            return; // The menu absorbs the keypress
                        }

                        if (Mx.widget && (Mx.widget.type === "ONESHOT")) {
                            Mx.widget = null;
                            plot.refresh();
                            return;
                        }

                        // Only respond to keypresses if the mouse is
                        // in the plot area....
                        var keyCode = getKeyCode(event);
                        if (keyCode === 97) { // 'a'
                            Gx.iabsc = (Gx.iabsc + 1) % 4;
                            // It's kinda up in the air if changing the 'specs'
                            // area should also change the plotting mode itself...
                            // on one hand, if you have multiple layers with different
                            // xdeta's then switching the specs area to index mode will
                            // give you only the index of the baselayer...on the other hand
                            // the use may only want to change the readout and not the x-axis
                            // or the plot...for now this is commented out to behave in the same
                            // manner as SIGPLOT.
                            //plot.change_settings({
                            //	index : Gx.iabsc === 1
                            //});
                            display_specs(plot);
                        } else if (keyCode === 108) { // 'l'
                            plot.change_settings({
                                legend: !Gx.legend
                            }); // toggle the legend
                        } else if (keyCode === 103) { // 'g'
                            plot.change_settings({
                                grid: !Gx.grid
                            }); // toggle the legend
                        } else if ((keyCode === 98) || (keyCode === 2)) { // 'b' and CTRL-'b'
                            if (Mx.warpbox) {
                                if (Mx.warpbox.mode === "box") {
                                    Mx.warpbox.mode = "horizontal";
                                } else if (Mx.warpbox.mode === "horizontal") {
                                    Mx.warpbox.mode = "vertical";
                                } else {
                                    Mx.warpbox.mode = "box";
                                }
                                mx.redraw_warpbox(Mx);
                            }
                        } else if (keyCode === 99) { // 'c'
                            plot.change_settings({
                                xcnt: -1 * Gx.cntrls
                            });
                        } else if (keyCode === 114) { // 'r'
                            plot.change_settings({
                                show_readout: !Gx.show_readout
                            });
                        } else if (keyCode === 115) { // 's'
                            plot.change_settings({
                                specs: !Gx.specs
                            });
                        } else if (keyCode === 120) { // 'x'
                            sigplot_show_x(plot);
                        } else if (keyCode === 121) { // 'y'
                            sigplot_show_y(plot);
                        } else if (keyCode === 122) { // 'z'
                            sigplot_show_z(plot);
                        } else if (keyCode === 116) { // 't'
                            sigplot_show_timecode(plot);
                        } else if (keyCode === 109) { // 'm'
                            sigplot_mainmenu(plot);
                        } else if (keyCode === 63) { // '?'
                            mx.message(Mx, MAIN_HELP);
                        } else if (keyCode === 102) { // 'f'
                            mx.fullscreen(Mx);
                            plot.refresh();
                        } else if ((keyCode === 9) && (event.ctrlKey)) { // ctrl-i
                            plot.change_settings({
                                invert: null
                            });
                        }
                    }
                };
            }(this));

            setKeypressHandler(this.onkeypress);
        }

        return this;
    };

    // Public methods

    sigplot.Plot.prototype = {

        /**
         * Add a plugin to the plot
         *
         * @param plugin
         *            the plugin object
         *
         * @param zorder
         *            the zorder for the plugin to render, all plugins render as
         *            overlays on top of the plot
         */
        add_plugin: function(plugin, zorder) {
            if (zorder === undefined) {
                zorder = Number.MAX_VALUE;
            }
            if (zorder <= 0) {
                throw "Invalid plugin zorder";
            }


            plugin.init(this);

            var canvas = document.createElement('canvas');
            canvas.width = this._Mx.canvas.width;
            canvas.height = this._Mx.canvas.height;

            this._Gx.plugins.push({
                impl: plugin,
                zorder: zorder,
                canvas: canvas
            });

            this._Gx.plugins.sort(function(a, b) {
                return (a.zorder - b.zorder);
            });


            this.refresh();
        },

        /**
         * Removes a plugin from the plot
         *
         * @param plugin
         *            the plugin object
         */
        remove_plugin: function(plugin) {
            for (var i = 0; i < this._Gx.plugins.length; i++) {
                if (this._Gx.plugins[i].impl === plugin) {
                    if (plugin.dispose) {
                        plugin.dispose();
                    }
                    if (this._Gx.plugins[i].canvas.parentNode) {
                        this._Gx.plugins[i].canvas.parentNode.removeElement(this._Gx.plugins[i].canvas);
                    }
                }
            }
            this._Gx.plugins.sort(function(a, b) {
                return (a.zorder - b.zorder);
            });

            this.refresh();
        },

        /**
         * Adds a listener to plot events.
         *
         * @param what
         *            the event to listen to mtag = a mouse 'tag' event has
         *            occurred, mmove = a mouse move event has occurred, mdown =
         *            a mouse down event has occurred, mup = a mouse up event
         *            has occurred, showmenu = showmenu even has occurred,
         *            sigplotexit = an exit plot event has occurred, reread = a
         *            reread event has occurred, file_deoverlayed = a file has
         *            been deoverlayed, file_overlayed = a file has been
         *            overlayed,
         *
         * @param callback
         */
        addListener: function(what, callback) {
            var Mx = this._Mx;
            mx.addEventListener(Mx, what, callback, false);
        },

        /**
         * Removes a listener to plot events.
         *
         * @param what
         *            the event that was listned to
         * @param callback
         */
        removeListener: function(what, callback) {
            var Mx = this._Mx;
            mx.removeEventListener(Mx, what, callback, false);
        },

        /**
         * Change one or more plot settings. For boolean types, passing null
         * will toggle the setting.
         *
         * @param settings
         *            the settings to change.
         *
         * @param {Boolean}
         *            settings.grid change grid visibility
         *
         * @param {Boolean}
         *            settings.index change index setting
         *
         * @param {Boolean}
         *            settings.all change the plot to show all data
         *
         * @param {Boolean}
         *            settings.show_x_axis
         *
         * @param {Boolean}
         *            settings.show_y_axis
         *
         * @param {Boolean}
         *            settings.show_readout
         *
         * @param {Boolean}
         *            settings.specs
         *
         * @param {String}
         *            settings.xcnt "leftmouse", "continuous", "disable",
         *            "enable"
         *
         * @param {Boolean}
         *            settings.legend
         *
         * @param {Boolean}
         *            settings.pan
         *
         * @param {Boolean}
         *            settings.cross
         *
         * @param {String}
         *            settings.rubberbox_action
         *
         * @param {String}
         *            settings.rubberbox_mode
         *
         * @param {String}
         *            settings.wheelscroll_mode_natural
         *
         * @param {String}
         *            settings.cmode
         *
         * @param {String}
         *            settings.phunits
         */
        change_settings: function(settings) {
            var Gx = this._Gx;
            var Mx = this._Mx;

            for (var i = 0; i < Gx.lyr.length; i++) {
                Gx.lyr[i].change_settings(settings);
            }

            if (settings.grid !== undefined) {
                if (settings.grid === null) {
                    Gx.grid = !Gx.grid;
                } else {
                    Gx.grid = settings.grid;
                }
            }

            if (settings.gridBackground !== undefined) {
                Gx.gridBackground = settings.gridBackground;
            }

            if (settings.gridStyle !== undefined) {
                Gx.gridStyle = settings.gridStyle;
            }

            if (settings.wheelZoom !== undefined) {
                Gx.wheelZoom = settings.wheelZoom;
            }

            if (settings.wheelZoomPercent !== undefined) {
                Gx.wheelZoomPercent = settings.wheelZoomPercent;
            }

            if (settings.autol !== undefined) {
                Gx.autol = settings.autol;
            }

            if ((settings.index !== undefined) && (settings.index !== Gx.index)) {
                if (settings.index === null) {
                    Gx.index = !Gx.index;
                } else {
                    Gx.index = settings.index;
                }

                // the original sigplot.for fails
                // to do this so that the specs area
                // has the correct setting.
                if ((Gx.index) && (Gx.iabsc !== 1)) {
                    Gx.iabsc = 1;
                } else if ((!Gx.index) && (Gx.iabsc === 1)) {
                    Gx.iabsc = 0;
                }

                var xmin;
                var xmax;
                scale_base(this, {
                    get_data: false
                }, xmin, xmax);

                // like sigplot, undo all zoom levels
                this.unzoom();
            }

            if (settings.all !== undefined) {
                if (settings.all === null) {
                    Gx.all = !Gx.all;
                } else {
                    Gx.all = settings.all;
                }
            }

            if (settings.show_x_axis !== undefined) {
                if (settings.show_x_axis === null) {
                    Gx.show_x_axis = !Gx.show_x_axis;
                } else {
                    Gx.show_x_axis = settings.show_x_axis;
                }
                Gx.specs = (Gx.show_x_axis || Gx.show_y_axis || Gx.show_readout);
            }

            if (settings.show_y_axis !== undefined) {
                if (settings.show_y_axis === null) {
                    Gx.show_y_axis = !Gx.show_y_axis;
                } else {
                    Gx.show_y_axis = settings.show_y_axis;
                }
                Gx.specs = (Gx.show_x_axis || Gx.show_y_axis || Gx.show_readout);
            }

            if (settings.show_readout !== undefined) {
                if (settings.show_readout === null) {
                    Gx.show_readout = !Gx.show_readout;
                } else {
                    Gx.show_readout = settings.show_readout;
                }
                Gx.specs = (Gx.show_x_axis || Gx.show_y_axis || Gx.show_readout);
            }

            if (settings.specs !== undefined) {
                if (settings.specs === null) {
                    Gx.specs = !Gx.specs;
                } else {
                    Gx.specs = settings.specs;
                }
                if (Gx.specs) {
                    Gx.show_x_axis = true;
                    Gx.show_y_axis = true;
                    Gx.show_readout = true;
                } else {
                    Gx.show_x_axis = false;
                    Gx.show_y_axis = false;
                    Gx.show_readout = false;
                }
            }

            if (settings.xcnt !== undefined) {
                if (settings.xcnt === "leftmouse") {
                    Gx.cntrls = 1;
                } else if (settings.xcnt === "continuous") {
                    Gx.cntrls = 2;
                } else if ((settings.xcnt === "disable") && (Gx.cntrls > 0)) {
                    Gx.cntrls = -1 * Gx.cntrls;
                } else if ((settings.xcnt === "enable") && (Gx.cntrls < 0)) {
                    Gx.cntrls = -1 * Gx.cntrls;
                } else {
                    Gx.cntrls = settings.xcnt;
                }
            }

            if (settings.legend !== undefined) {
                if (settings.legend === null) {
                    Gx.legend = !Gx.legend;
                } else {
                    Gx.legend = settings.legend;
                }
                draw_accessories(this, -1);

                var i = Gx.lbtn - 2;
                if (Gx.show_readout) {
                    Gx.legendBtnLocation = {
                        x: this._Mx.width - Gx.lbtn,
                        y: 2,
                        width: i,
                        height: i
                    };
                    mx.shadowbox(this._Mx, this._Mx.width - Gx.lbtn, 2, i, i,
                        1, -1, 'L');
                } else {
                    Gx.legendBtnLocation = {
                        x: this._Mx.width - Gx.lbtn,
                        y: 2,
                        width: i,
                        height: i
                    };
                    mx.shadowbox(this._Mx, this._Mx.width - Gx.lbtn, 2, i, i,
                        1, 1, 'L');
                }
                draw_accessories(this, 1);
            }

            if (settings.pan !== undefined) {
                if (settings.pan === null) {
                    Gx.pan = !Gx.pan;
                } else {
                    Gx.pan = settings.pan;
                }
            }

            if (settings.cross !== undefined) {
                if (settings.cross === null) { // catch null or undefined here
                    Gx.cross = !Gx.cross;
                } else {
                    Gx.cross = settings.cross;
                }
                if (!Gx.cross) {
                    if (Gx.cross_xpos !== undefined) {
                        mx.rubberline(Mx, Gx.cross_xpos, Mx.t, Gx.cross_xpos,
                            Mx.b);
                    }
                    if (Gx.cross_ypos !== undefined) {
                        mx.rubberline(Mx, Mx.l, Gx.cross_ypos, Mx.r,
                            Gx.cross_ypos);
                    }
                    Gx.cross_xpos = undefined;
                    Gx.cross_ypos = undefined;
                } else {
                    Gx.cross_xpos = undefined;
                    Gx.cross_ypos = undefined;
                    draw_crosshairs(this);
                }
            }

            if (settings.cmode !== undefined) {
                changemode(this, settings.cmode);
            }

            if (settings.phunits !== undefined) {
                changephunits(this, settings.phunits);
            }

            if (settings.rubberbox_action !== undefined) {
                Gx.default_rubberbox_action = settings.rubberbox_action;
            }

            if (settings.rubberbox_mode !== undefined) {
                Gx.default_rubberbox_mode = settings.rubberbox_mode;
            }

            if (settings.wheelscroll_mode_natural !== undefined) {
                Gx.wheelscroll_mode_natural = settings.wheelscroll_mode_natural;
            }

            if (settings.colors !== undefined) {
                if (!settings.colors.fg) {
                    settings.colors.fg = Mx.fg;
                }
                if (!settings.colors.bg) {
                    settings.colors.bg = Mx.bg;
                }
                mx.setbgfg(Mx, settings.colors.bg, settings.colors.fg, Mx.xi);
            }

            if (settings.cmap !== undefined) {
                if (settings.cmap === null) {
                    // default
                    if (Gx.cmode === 2) {
                        Gx.cmap = 2; // wheel
                    } else {
                        Gx.cmap = 1; // ramp
                    }
                } else {
                    Gx.cmap = settings.cmap; // TODO support string lookup
                }

                mx.colormap(Mx, m.Mc.colormap[Gx.cmap], Gx.ncolors);
            }

            if (settings.yinv !== undefined) {
                if (settings.yinv) {
                    Mx.origin = 4;
                } else {
                    Mx.origin = 1;
                }
            }

            if (settings.rasterSmoothing !== undefined) {
                if (settings.rasterSmoothing === null) {
                    Gx.rasterSmoothing = !Gx.rasterSmoothing;
                } else {
                    Gx.rasterSmoothing = settings.rasterSmoothing;
                }
            }

            if (settings.fillStyle !== undefined) {
                Gx.fillStyle = settings.fillStyle;
            }

            if (settings.invert !== undefined) {
                if (settings.invert === null) {
                    mx.invertbgfg(Mx);
                } else if (settings.invert === true) {
                    mx.setbgfg(this, "white", "black");
                } else {
                    mx.setbgfg(this, "black", "white");
                }
            }

            if (settings.nomenu !== undefined) {
                if (settings.nomenu === null) {
                    Gx.nomenu = !Gx.nomenu;
                } else {
                    Gx.nomenu = settings.nomenu;
                }
            }

            if (settings.ymin !== undefined) {
                updateViewbox(this, settings.ymin, Mx.stk[0].ymax, "Y");
            }

            if (settings.ymax !== undefined) {
                updateViewbox(this, Mx.stk[0].ymin, settings.ymax, "Y");
            }

            if (settings.xmin !== undefined) {
                updateViewbox(this, settings.xmin, Mx.stk[0].xmax, "X");
            }

            if (settings.xmax !== undefined) {
                updateViewbox(this, Mx.stk[0].xmin, settings.xmax, "X");
            }

            this.refresh();
            if (settings.pan !== undefined) { // refactor - new code to handle
                // disappearing specs
                display_specs(this);
            }
        },

        /**
         * Reread all files and refresh the plot.
         */
        reread: function() {
            var Gx = this._Gx;
            var oldLayerData = [];
            for (var k = 0; k < Gx.lyr.length; k++) { // make a copy of layer
                // data before
                // destroying Gx.lyr
                // with the deoverlay
                oldLayerData[k] = Gx.lyr[k];
            }

            var origHCB = Gx.HCB.slice();
            this.deoverlay();
            for (var i = 0; i < origHCB.length; i++) {
                this.overlay_bluefile(origHCB[i]);
            }

            // propagate old layer attributes to re-read layers
            for (var j = 0; j < Gx.lyr.length; j++) {
                // TODO Assumes indices of old Gx.lyr and new Gx.lyr will match
                // up correctly - should we instead use hcb and name to identify
                Gx.lyr[j].symbol = oldLayerData[j].symbol;
                Gx.lyr[j].radius = oldLayerData[j].radius;
                // TODO re-copy other things like line type???
            }
            this.refresh();

            // Notify listeners that a reread was performed
            var evt = document.createEvent('Event');
            evt.initEvent('reread', true, true);
            mx.dispatchEvent(this._Mx, evt);
        },

        /**
         * Placeholder for cleanup logic.
         */
        cleanup: function() {
            // TODO not sure what we really want to do here yet
        },

        /**
         * Reload data without adjusting other aspects about a plot
         *
         * @param {Number} n
         *            the layer to push data into 
         * @param {Number[]} data
         *            data to push
         * @param {Object} hdrmod 
         *            optional changes to the file header
         */
        reload: function(n, data, hdrmod) {
            var Mx = this._Mx;
            var Gx = this._Gx;
            if ((n < 0) || (n >= Gx.lyr.length)) { return; }

            if (Gx.lyr[n].reload === undefined) { return; }

            var xbnds = Gx.lyr[n].reload(data, hdrmod);

            if (Mx.level === 0) {
                // Unlike push(), always call scale_base
                // when reload is invoked
                scale_base(this, {
                    get_data: false
                }, xbnds.xmin, xbnds.xmax);
            }

            this.refresh();

        },

        rescale: function() {
            var Mx = this._Mx;

            if (Mx.level === 0) {
                scale_base(this, {
                    get_data: false
                }, undefined, undefined);
            }

            this.refresh();
        },

        /**
         * Push data into a layer that was created with overlay_pipe
         * 
         * @param {Number} n
         *            the layer to push data into 
         * @param {Number[]} data
         *            data to push
         * @param {Object} hdrmod 
         *            optional changes to the file header
         * @param {boolean} [sync=false]
         *            optional dispatch onpipewrite syncronously 
         */
        push: function(n, data, hdrmod, sync) {
            var Mx = this._Mx;
            var Gx = this._Gx;
            if ((n < 0) || (n >= Gx.lyr.length)) { return; }
            
            if (Gx.lyr[n].push === undefined) { return; }

            var rescale = Gx.lyr[n].push(data, hdrmod, sync);

            if ((Mx.level === 0) && rescale) {
                scale_base(this, {
                    get_data: false
                });
            }

            this.refresh();
        },

        /**
         * Create a plot layer backed by an array
         *
         * @param filname
         * @param data
         *            {Number[]} data to plot
         * @param overrides
         *            optional bluefile header overrides
         * @param layerType
         */
        overlay_array: function(data, overrides, layerOptions) {
	    m.log.debug("Overlay array");
            var hcb = m.initialize(data, overrides);
            return this.overlay_bluefile(hcb, layerOptions);
        },

        overlay_pipe: function(overrides, layerOptions) {
	    m.log.debug("Overlay pipe");
            if (!overrides) {
                overrides = {};
            }
            overrides.pipe = true;
            var hcb = m.initialize(null, overrides);
            //console.log("pipe filename: "+hcb.file_name);
            return this.overlay_bluefile(hcb, layerOptions);
        },

        overlay_websocket: function(wsurl, overrides, layerOptions) {
	    m.log.debug("Overlay websocket: " + wsurl);
            var ws = new WebSocket(wsurl, "plot-data");
            ws.binaryType = "arraybuffer";

            var plot = this;
            var hcb = m.initialize(null, overrides);
            hcb.ws = ws;

            var layer_n = this.overlay_bluefile(hcb, layerOptions);

            ws.onopen = function(evt) {};

            ws.onmessage = (function(theSocket) {
                return function(evt) {
                    if (evt.data instanceof ArrayBuffer) {
                        var data = hcb.createArray(evt.data);
                        plot.reload(layer_n, data);
                    } else if (typeof evt.data === "string") {
                        var Gx = plot._Gx;
                        var hdr = Gx.HCB[Gx.lyr[layer_n].hcb];

                        var newHdr = JSON.parse(evt.data);

                        for (var field in newHdr) {
                            hdr[field] = newHdr[field];
                        }
                        hcb.size = undefined; // trigger rescale
                    }
                };
            })(ws);

            return layer_n;
        },

        /**
         * Create a plot layer from an HREF that points to a BLUEFILE
         *
         * @param {String}
         *            href the url to the bluefile
         * @param [onload]
         *            callback to be called when the file has been loaded
         */
        overlay_href: function(href, onload, layerOptions) {
	    m.log.debug("Overlay href: " + href);
            try {
                this.show_spinner();

                var handleHeader = (function(plot, onload) {
                    return function(hcb) {
                        try {
                            if (!hcb) {
                                alert("Failed to load data");
                            } else {
                                var i = plot.overlay_bluefile(hcb, layerOptions);
                                if (onload) {
                                    onload(hcb, i);
                                }
                            }
                        } finally {
                            plot.hide_spinner();
                        }
                    };
                }(this, onload));

                var br = new BlueFileReader();
                br.read_http(href, handleHeader);
            } catch (error) {
                console.log(error);
                alert("Failed to load data");
                this.hide_spinner();
            }
        },

        show_spinner: function() {
            if (!this._Gx.spinner) {
                SPINNER_OPTS.color = this._Mx.xwfg;
                this._Gx.spinner = new Spinner(SPINNER_OPTS).spin(this._Gx.parent);
            }
        },

        hide_spinner: function() {
            if (this._Gx.spinner) {
                this._Gx.spinner.stop();
            }
            this._Gx.spinner = undefined;
        },

        add_layer: function(layer) {
            var Gx = this._Gx;
            var Mx = this._Mx;

            Gx.lyr.push(layer);

            // Notify listeners that a file was overlayed
            var evt = document.createEvent('Event');
            evt.initEvent('file_overlayed', true, true);
            evt.index = Gx.lyr.length - 1; // the new index of the layer
            evt.name = layer.name; // the name of the layer
            mx.dispatchEvent(Mx, evt);
        },

        get_layer: function(n) {
            var Gx = this._Gx;
            if ((n >= 0) && (n < Gx.lyr.length)) {
                return Gx.lyr[n];
            } else {
                return null;
            }
        },

        /**
         * Create a plot layer backed by a bluefile header
         *
         * @param hcb
         *            {BlueHeader} an opened BlueHeader file
         * @returns the index of the new layer
         */
        overlay_bluefile: function(hcb, layerOptions) {
	    m.log.debug("Overlay bluefile: " + hcb.file_name);
            var Mx = this._Mx;
            var Gx = this._Gx;
            var size = 0;

            layerOptions = layerOptions || {};

            var basefiles = (Gx.HCB.length === 0);

            Gx.HCB.push(hcb);

            if (Gx.HCB.length === 1) {
                basefile(this, true);
            }

            var newlayer = Gx.lyr.length;

            if (layerOptions.layerType === undefined) {
                if (hcb["class"] === 1) {
                    sigplot.Layer1D.overlay(this, hcb, layerOptions);
                } else if (hcb["class"] === 2) {
                    sigplot.Layer2D.overlay(this, hcb, layerOptions);
                }
            } else {
                layerOptions.layerType.overlay(this, hcb, layerOptions);
            }

            // TODO - do we want to alert like the XM plot did?
            //if (!Gx.all && size > Gx.bufmax && Gx.HCB.length == 1) {
            // alert("Plot truncated to buffer size. Use panning or /ALL
            // switch");
            //}
            // The original code has a bug here. Fixed by moving changemode
            // outside of
            // the !basefiles check.
            // You can recreate with SIGPLOT ,,, IR
            // And then loading a file.
            changemode(this, Gx.cmode);

            if (!basefiles) {
                for (var n = newlayer; n < Gx.lyr.length; n++) {
                    draw_layer(this, n);
                }
            } else {
                if (Gx.HCB.length === 0) { // TODO dead code that cannot be reached
                    basefile(this, false);
                } else {
                    Gx.basemode = Gx.cmode;
                    var xmin;
                    var xmax;
                    if ((Gx.autox && 1) === 0) {
                        xmin = Gx.xmin;
                    }
                    if ((Gx.autox && 2) === 0) {
                        xmax = Gx.xmin;
                    }
                    scale_base(this, {
                        get_data: true
                    }, xmin, xmax);
                    Mx.level = 0;
                    if ((Gx.autox && 1) !== 0) {
                        Gx.xmin = Mx.stk[0].xmin;
                    }
                    if ((Gx.autox && 2) !== 0) {
                        Gx.xmax = Mx.stk[0].xmax;
                    }
                    if ((Gx.autoy && 1) !== 0) {
                        Gx.ymin = Mx.stk[0].ymin;
                    }
                    if ((Gx.autoy && 2) !== 0) {
                        Gx.ymax = Mx.stk[0].ymax;
                    }
                    Mx.resize = true;
                    if (Gx.lyr[0].preferred_origin) {
                        Mx.origin = Gx.lyr[0].preferred_origin;
                    } else {
                        Mx.origin = 1;
                    }
                }
            }
            form_plotnote(this);
            this.refresh();

            return (Gx.HCB.length - 1);
        },

        /**
         * Load one or more files.
         *
         * @param {File[]}
         *            a list of files to plot
         */
        load_files: function(files, layerType) {
	    var onload = (function(plot) {
                return function(hdr) {
                    plot.overlay_bluefile(hdr, layerType);
                };
            })(this);

            for (var i = 0; i < files.length; i++) {
                var f = files[i];
                var br = new BlueFileReader();
                br.read(f, onload);
            }
        },

        /**
         * Remove layers.
         *
         * @param [index]
         *            the layer to remove, if not provided all layers are
         *            removed. Negative indices can be used to remove layers
         *            from the back of the layer stack.
         */
        deoverlay: function(index) {
            var Gx = this._Gx;
            var Mx = this._Mx;

            if (Gx.HCB.length > 0) {
                if (index === undefined) {
                    for (var n = Gx.HCB.length - 1; n >= 0; n--) {
                        this.remove_layer(n);
                    }
                } else if (index < 0) {
                    var n = Gx.HCB.length + index;
                    if (n < 0) {
                        return;
                    }
                    this.remove_layer(n);
                } else if (index < Gx.HCB.length) {
                    this.remove_layer(index);
                }
            }
            if (Gx.lyr.length === 0) {
                basefile(this, false);
                scale_base(this, {});
            }
        },

        /**
         * Remove a layer.
         *
         * @param index
         *            the layer to remove
         */
        remove_layer: function(index) {
            var Gx = this._Gx;

            var fileName = "";
            var HCB = null;

            if ((index >= 0) && (index < Gx.HCB.length)) {
                fileName = Gx.HCB[index].file_name;
                // TODO if (Gx.modsource > 0) {
                //	
                // }
                HCB = Gx.HCB[index];
                Gx.HCB[index] = null;
                for (var n = index; n < Gx.HCB.length - 1; n++) {
                    Gx.HCB[n] = Gx.HCB[n + 1];
                }
                Gx.HCB.length -= 1;
            }

            for (var n = Gx.lyr.length - 1; n >= 0; n--) {
                if (Gx.lyr[n].hcb === HCB) {
                    delete_layer(this, n);
                }
            }
            form_plotnote(this);
            this.refresh();

            // Notify listeners that a file has been deoverlayed
            var evt = document.createEvent('Event');
            evt.initEvent('file_deoverlayed', true, true);
            if (fileName !== "") {
                evt.fileName = fileName; // The fileName that was
	    }
            // de-overlayed
            mx.dispatchEvent(this._Mx, evt);
        },

        /**
         * Zoom onto a given pixel range.
         */
        pixel_zoom: function(x1, y1, x2, y2, continuous) {
            var r1 = pixel_to_real(this, x1, y1);
            var r2 = pixel_to_real(this, x2, y2);

            this.zoom(r1, r2, continuous);
        },

        percent_zoom: function(xperc, yperc, continuous) {
            var Mx = this._Mx;
            var Gx = this._Gx;

            var xadj = 0;
            if (Math.abs(xperc) < 1) {
                xadj = Math.abs(Mx.stk[Mx.level].xmax - Mx.stk[Mx.level].xmin);
                xadj = (xadj * xperc) / 2;
            }

            var yadj = 0;
            if (Math.abs(yperc) < 1) {
                yadj = Math.abs(Mx.stk[Mx.level].ymax - Mx.stk[Mx.level].ymin);
                yadj = (yadj * yperc) / 2;
            }

            var ul = {
                x: Math.max(Mx.stk[Mx.level].xmin + xadj, Gx.panxmin),
                y: Math.max(Mx.stk[Mx.level].ymin + yadj, Gx.panymin)
            };
            var lr = {
                x: Math.min(Mx.stk[Mx.level].xmax - xadj, Gx.panxmax),
                y: Math.min(Mx.stk[Mx.level].ymax - yadj, Gx.panymax)
            };

            this.zoom(ul, lr, continuous);
        },

        /**
         * Zoom onto a given region.
         *
         * @param ul
         *            the uppler left corner
         * @param {Number}
         *            ul.x the upper left x pos in real plot value
         * @param {Number}
         *            ul.y the upper left y pos in real plot values
         *
         * @param lr
         *            the lower right corner
         * @param {Number}
         *            lr the lower right x pos in real plot value
         * @param {Number}
         *            lr the lower right y pos in real plot values
         *
         * @param continuous
         *            enter continuous zoom mode.  This will create a
         *            new if you are on level 0, but stay on the same level
         *            otherwise
         */
        zoom: function(ul, lr, continuous) {
            var Mx = this._Mx;
            var Gx = this._Gx;

            if (Mx.level >= 9) { // currently only allow 10 zooms
                return;
            }

            if (ul.x === undefined) {
                ul.x = Mx.stk[Mx.level].xmin;
            }
            if (ul.y === undefined) {
                ul.y = Mx.stk[Mx.level].ymin;
            }
            if (lr.x === undefined) {
                lr.x = Mx.stk[Mx.level].xmax;
            }
            if (lr.y === undefined) {
                lr.y = Mx.stk[Mx.level].ymax;
            }

            if (lr.x < ul.x) {
                var xtmp = lr.x;
                lr.x = ul.x;
                ul.x = xtmp;
            }
            if (lr.y < ul.y) {
                var ytmp = lr.y;
                lr.y = ul.y;
                ul.y = ytmp;
            }

            var zstk = {};

            // xscl/yscl are reset in sigplot.refresh
            zstk.xscl = Mx.stk[Mx.level].xscl;
            zstk.yscl = Mx.stk[Mx.level].yscl;

            zstk.xmin = ul.x; // real world val at x1(origin=1,4) or
            // x2(origin=2,4)
            zstk.xmax = lr.x; // real world val at x2(origin=1,4) or
            // x1(origin=2,4)
            zstk.ymin = ul.y; // real world val at y2(origin=1,2) or
            // y1(origin=3,4)
            zstk.ymax = lr.y; // real world val at y1(origin=1,2) or
            // y2(origin=3,4)
            if (Gx.index) {
                zstk.xmin = Math.min(zstk.xmin / Gx.xdelta);
                zstk.xmax = Math.min(zstk.xmax / Gx.xdelta);
            }

            if (!continuous || (!Gx.inContinuousZoom)) {
                // We aren't yet in continuous zoom mode
                // so create a new level
                Mx.stk.push(zstk);
                Mx.level = Mx.stk.length - 1;
            } else {
                // Once in continuous zoom mode update the current level
                Mx.stk[Mx.level] = zstk;
            }
            Gx.inContinuousZoom = continuous;

            var evt = document.createEvent('Event');
            evt.initEvent('zoom', true, true);
            evt.level = Mx.level;
            evt.inContinuousZoom = Gx.inContinuousZoom;
            evt.xmin = Mx.stk[Mx.level].xmin;
            evt.ymin = Mx.stk[Mx.level].ymin;
            evt.xmax = Mx.stk[Mx.level].xmax;
            evt.ymax = Mx.stk[Mx.level].ymax;
            mx.dispatchEvent(Mx, evt);

            this.refresh();
        },

        /**
         * Unzoom one or more levels.
         *
         * @param [levels]
         *            the number of levels to unzoom, if not provided unzoom
         *            all.
         */
        unzoom: function(levels) {
            var Mx = this._Mx;
            var Gx = this._Gx;

            if (Mx.level === 0) {
                return;
            }

            if (!levels) {
                levels = Mx.stk.length;
            }

            while (levels > 0) {
                if (Mx.level === 0) {
                    break;
                }
                Mx.stk.pop();
                Mx.level = Mx.stk.length - 1;
                levels -= 1;
            }
            // After any unzooms you can no longer remain in
            // continuous zoom
            Gx.inContinuousZoom = false;

            // Send the event to listeners
            var evt = document.createEvent('Event');
            evt.initEvent('unzoom', true, true);
            evt.level = Mx.level;
            evt.xmin = Mx.stk[Mx.level].xmin;
            evt.ymin = Mx.stk[Mx.level].ymin;
            evt.xmax = Mx.stk[Mx.level].xmax;
            evt.ymax = Mx.stk[Mx.level].ymax;
            mx.dispatchEvent(Mx, evt);

            this.refresh();
        },

        /**
         * Register this plot to mimic zoom/unzoom of other plot
         *
         * @param other
         *     the other plot to mimic
         *
         * @param mask
         *     the set of event to respond to
         *
         * @param mask.zoom
         *     if true, respond to zoom events
         *
         * @param mask.xzoom
         *     if true, respond to zoom events on for the x-axis only
         *
         * @param mask.yzoom
         *     if true, respond to zoom events on for the y-axis only
         *
         * @param mask.unzoom
         *     if true, respond to unzoom events
         *
         */
        mimic: function(other, mask) {
            var self = this;

            if (!mask) {
                mask = {};
            }

            if (mask.zoom) {
                other.addListener("zoom", function(event) {
                    self.zoom({
                            x: event.xmin,
                            y: event.ymin
                        }, {
                            x: event.xmax,
                            y: event.ymax
                        },
                        event.inContinuousZoom);
                });
            } else if (mask.xzoom) {
                other.addListener("zoom", function(event) {
                    self.zoom({
                            x: event.xmin,
                            y: undefined
                        }, {
                            x: event.xmax,
                            y: undefined
                        },
                        event.inContinuousZoom);
                });
            } else if (mask.yzoom) {
                other.addListener("zoom", function(event) {
                    self.zoom({
                            x: undefined,
                            y: event.ymin
                        }, {
                            x: undefined,
                            y: event.ymax
                        },
                        event.inContinuousZoom);
                });
            }

            if (mask.unzoom) {
                other.addListener("unzoom", function(event) {
                    self.unzoom(1);
                });
            }

        },

        // TODO - do we want an unmimic?

        /**
         * Like refresh, but doesn't rerender data
         *
         */
        redraw: function() {
            var Gx = this._Gx;
            var Mx = this._Mx;
            var ctx = Mx.canvas.getContext("2d");

            if (!Gx.plotData.valid) {
                this.refresh();
            } else {
		ctx.drawImage(Gx.plotData,
			      Mx.l - 1,
			      Mx.t - 1,
			      (Mx.r - Mx.l) + 2,
			      (Mx.b - Mx.t) + 2,
			      Mx.l - 1,
			      Mx.t - 1,
			      (Mx.r - Mx.l) + 2,
			      (Mx.b - Mx.t) + 2
			     );

                draw_plugins(this);

                Gx.cross_xpos = undefined;
                Gx.cross_ypos = undefined;
                draw_crosshairs(this);
            }
        },

        /**
         * Refresh the entire plot
         */
        refresh: function() {
            var self = this;
            mx.render(this._Mx, function() {
                self._refresh();
            });
        },

        enable_listeners: function() {
            var Mx = this._Mx;
            mx.addEventListener(Mx, "mousedown", this.onmousedown, false);
            mx.addEventListener(Mx, "mousemove", this.throttledOnMouseMove, false);
            document.addEventListener("mouseup", this.docMouseUp, false);
            mx.addEventListener(Mx, "mouseup", this.mouseup, false);
            window.addEventListener("mousedown", this.dragMouseDownHandler, false);
            window.addEventListener("mousemove", this.throttledDragOnMouseMove, false);
            window.addEventListener("mouseup", this.dragMouseUpHandler, false);
            window.addEventListener("wheel", this.wheelHandler, false);
            window.addEventListener("mousewheel", this.wheelHandler, false);
            window.addEventListener("DOMMouseScroll", this.wheelHandler, false);
            window.addEventListener("keypress", this.onkeypress, false);
        },

        disable_listeners: function() {
            var Mx = this._Mx;

            mx.removeEventListener(Mx, "mousedown", this.onmousedown, false);
            mx.removeEventListener(Mx, "mousemove", this.throttledOnMouseMove,
                false);
            document.removeEventListener("mouseup", this.docMouseUp, false);
            mx.removeEventListener(Mx, "mouseup", this.mouseup, false);
            window.removeEventListener("mousedown", this.dragMouseDownHandler,
                false);
            window.removeEventListener("mousemove", this.throttledDragOnMouseMove,
                false);
            window.removeEventListener("mouseup", this.dragMouseUpHandler, false);
            window.removeEventListener("wheel", this.wheelHandler, false);
            window.removeEventListener("mousewheel", this.wheelHandler, false);
            window.removeEventListener("DOMMouseScroll", this.wheelHandler, false);
            window.removeEventListener("keypress", this.onkeypress, false);
        },

        checkresize: function() {
            if (mx.checkresize(this._Mx)) {
                this.refresh();
            }
        },

        _refresh: function() {
            var Mx = this._Mx;
            var Gx = this._Gx;
            var ctx = Mx.canvas.getContext("2d");
            var plugin_index = 0;

            if (Gx.hold) {
                return;
            }
            mx.set_font(Mx, Math.min(8, Mx.width / 64));
            Gx.pthk = Mx.text_w * 1.5;

            if (Gx.specs) {
                // Set left and right edges
                if (Gx.show_y_axis === true) {
                    Mx.l = Mx.text_w * 6;
                } else {
                    Mx.l = 1;
                }
                if (Gx.pan === true) {
                    Mx.r = Mx.width - (Gx.pthk + 2 * Mx.text_w);
                } else {
                    Mx.r = Mx.width - 2;
                }

                // Set top and bottom
                if (Gx.show_readout) {
                    Mx.t = Mx.text_h * 2;
                    if (Gx.show_x_axis) {
                        Mx.b = Mx.height - Mx.text_h * 4;
                    } else {
                        Mx.b = Mx.height - Mx.text_h * 3;
                    }
                } else {
                    if (Gx.pan) {
                        Mx.t = Gx.pthk + 2 * Mx.text_w;
                    } else {
                        Mx.t = 1;
                    }
                    if (Gx.show_x_axis) {
                        Mx.b = Mx.height - (Mx.text_h * 3) / 2;
                    } else {
                        Mx.b = Mx.height - 2;
                    }
                }

                // set left and right edges for X scrollbar
                if (Gx.show_readout) {
                    Gx.pl = Mx.text_w * 50;
                } else {
                    Gx.pl = Mx.text_w * 35;
                }
                Gx.pr = Math.max(Gx.pl + Mx.text_w * 9, Mx.r);

                // set top scrollbar edge for X scrollbar
                if (Gx.show_readout) {
                    if (Gx.show_x_axis) {
                        Gx.pt = Mx.b + Mx.text_h + (Mx.height - Mx.b - Mx.text_h - Gx.pthk) / 2;
                    } else {
                        Gx.pt = Mx.b + (Mx.height - Mx.b - Gx.pthk) / 2;
                    }
                } else {
                    Gx.pt = (Mx.t - Gx.pthk) / 2;
                }
                Gx.lbtn = Mx.text_h + Mx.text_w + 2;
            } else {
                if (Gx.pan) {
                    Mx.t = Gx.pthk + 2 * Mx.text_w;
                    Mx.r = Mx.width - (Gx.pthk + Mx.text_w);
                } else {
                    Mx.t = 1;
                    Mx.r = Mx.width - 2;
                }
                Mx.b = Mx.height - 2;
                Mx.l = 1;
                Gx.pl = Mx.l;
                Gx.pr = Mx.r;
                Gx.pt = (Mx.t - Gx.pthk) / 2;
                Gx.lbtn = 0;
            }

            // pan select ranges
            Gx.pyl = Mx.r + (Mx.width - Mx.r - Gx.pthk) / 2 + 1;

            // set virtual window size/pos/scaling for current level
            var k = Mx.level;
            Mx.stk[k].x1 = Mx.l;
            Mx.stk[k].y1 = Mx.t;
            Mx.stk[k].x2 = Mx.r;
            Mx.stk[k].y2 = Mx.b;
            Mx.stk[k].xscl = (Mx.stk[k].xmax - Mx.stk[k].xmin) / (Mx.r - Mx.l);
            Mx.stk[k].yscl = (Mx.stk[k].ymax - Mx.stk[k].ymin) / (Mx.b - Mx.t);

            // In case things have rescaled
            var re = pixel_to_real(this, Mx.xpos, Mx.ypos);
            Gx.retx = re.x;
            Gx.rety = re.y;

            // modify stack for section plotting
            //if (Gx.sections) {
            // TODO
            //}

            if (Gx.panning === 0 || Gx.panning !== 0) { // TODO Gx.panning !==
                // 0?? Does this work?
                Gx.plotData.valid = false;
                mx.clear_window(Mx);
            } //else if (!Gx.specs) {
            // TODO
            //} else if (Gx.panning === 1) {
            // TODO
            //} else {
            // TODO
            //}

            var xlab = Gx.xlab;
            var ylab = Gx.ylab;

            if (xlab === undefined) {
                xlab = 30;
            }
            if (Gx.index) {
                xlab = 0;
            }

            if (ylab === undefined) {
                var cx = ((Gx.lyr.length > 0) && Gx.lyr[0].cx);
                if (Gx.cmode === 1) {
                    ylab = 28;
                } else if (Gx.cmode === 2) {
                    ylab = Gx.plab;
                } else if ((Gx.cmode === 3) && (cx)) {
                    ylab = 21;
                } else if (Gx.cmode === 4) {
                    ylab = 22;
                } else if (Gx.cmode === 5) {
                    ylab = 22;
                    xlab = 21;
                } else if (Gx.cmode === 6) {
                    ylab = 26;
                } else if (Gx.cmode === 7) {
                    ylab = 27;
                } else {
                    ylab = 0;
                }
            }

            if (Gx.specs) {
                if (Gx.sections === 0) {
                    var drawaxis_flags = {
                        grid: Gx.grid
                    };
                    if (Gx.panning === 2) {
                        drawaxis_flags.noxtlab = true;
                    } // TODO Does this work??
                    if (!Gx.show_x_axis) {
                        drawaxis_flags.noxtics = true;
                        drawaxis_flags.noxtlab = true;
                        drawaxis_flags.noxplab = true;
                    }
                    if (!Gx.show_y_axis) {
                        drawaxis_flags.noytics = true;
                        drawaxis_flags.noytlab = true;
                        drawaxis_flags.noyplab = true;
                    }
                    if (Gx.specs && !Gx.show_readout && !Gx.pan) {
                        drawaxis_flags.noyplab = true;
                        drawaxis_flags.noxplab = true;
                    }
                    if (Gx.gridBackground) {
                        drawaxis_flags.fillStyle = Gx.gridBackground;
                    }
                    if (Gx.gridStyle) {
                        drawaxis_flags.gridStyle = Gx.gridStyle;
                    }
                    mx.drawaxis(Mx, Gx.xdiv, Gx.ydiv, xlab, ylab,
                        drawaxis_flags);
                } //else {
                // Not implemented yet
                //}

                var i = Gx.lbtn - 2;

                if (Gx.show_readout && Gx.pan) {
                    if (Gx.legend) {
                        Gx.legendBtnLocation = {
                            x: Mx.width - Gx.lbtn,
                            y: 2,
                            width: i,
                            height: i
                        };
                        mx.shadowbox(Mx, Mx.width - Gx.lbtn, 2, i, i, 1, -2,
                            'L');
                    } else {
                        Gx.legendBtnLocation = {
                            x: Mx.width - Gx.lbtn,
                            y: 2,
                            width: i,
                            height: i
                        };
                        mx
                            .shadowbox(Mx, Mx.width - Gx.lbtn, 2, i, i, 1,
                                2, 'L');
                    }
                    display_specs(this);
                }
            } else if (Gx.grid && Gx.sections >= 0) {
                var drawaxis_flags = {
                    grid: true,
                    noaxisbox: true,
                    noxtics: true,
                    noxtlab: true,
                    noxplab: true,
                    noytics: true,
                    noytlab: true,
                    noyplab: true
                };
                mx.drawaxis(Mx, Gx.xdiv, Gx.ydiv, xlab, ylab,
                    drawaxis_flags);
            }

            for (var n = 0; n < Gx.lyr.length; n++) {
                //if (Gx.sections !== 0) {
                // TODO
                //}
                draw_layer(this, n);
            }

            draw_accessories(this, 4);

            if ((Mx.r > Mx.l) && (Mx.b > Mx.t)) {
	      // Resize
              Gx.plotData.width = Mx.canvas.width;
              Gx.plotData.height = Mx.canvas.height;
	      Gx.plotData.getContext("2d").drawImage(Mx.canvas, 0, 0);
	      Gx.plotData.valid = true;
            }

            draw_plugins(this);


            Gx.cross_xpos = undefined;
            Gx.cross_ypos = undefined;
            draw_crosshairs(this);
        }
    };

    // /////////////////////////////////////////////////////////////////////////
    // Private methods and objects
    // /////////////////////////////////////////////////////////////////////////

    /**
     * Options used when displaying the spinner.
     *
     * @memberOf sigplot
     * @private
     */
    var SPINNER_OPTS = {
        lines: 13, // The number of lines to draw
        length: 7, // The length of each line
        width: 4, // The line thickness
        radius: 10, // The radius of the inner circle
        corners: 1, // Corner roundness (0..1)
        rotate: 0, // The rotation offset
        color: '#FFF', // #rgb or #rrggbb
        speed: 1, // Rounds per second
        trail: 60, // Afterglow percentage
        shadow: false, // Whether to render a shadow
        hwaccel: false, // Whether to use hardware acceleration
        className: 'spinner', // The CSS class to assign to the spinner
        zIndex: 2e9, // The z-index (defaults to 2000000000)
        top: 'auto', // Top position relative to parent in px
        left: 'auto' // Left position relative to parent in px
    };

    /**
     * Map integer cmode to string equivalent.
     *
     * @memberOf sigplot
     * @private
     */
    var cxm = ["Ma", "Ph", "Re", "Im", "IR", "Lo", "L2"];

    /**
     * Map integer abscissa mode to string equivalent.
     *
     * @memberOf sigplot
     * @private
     */
    var cam = ["(absc)", "(indx)", "(1/ab)", "(dydx)"];



    /**
     * This object holds the data associated with layers in the plot.
     *
     * @constructor
     * @memberOf sigplot
     * @private
     */
    function SIGPLOTLAYER() {

        this.xbuf = undefined; // raw (ArrayBuffer) of ABSC data
        this.ybuf = undefined; // raw (ArrayBuffer) of ORD data

        this.offset = 0.0;
        this.xstart = 0.0;
        this.xdelta = 0.0;
        this.imin = 0;
        this.xmin = 0.0;
        this.xmax = 0.0;
        this.name = "";
        this.cx = false;
        this.hcb = undefined; // index in Gx.HCB
        // xbufn = xbuf.byteLength
        // ybufn = ybuf.byteLength
        this.size = 0;

        this.display = true;
        this.color = 0;
        this.line = 3; // 0=none, 1-vertical, 2-horizontal, 3-connecting
        this.thick = 1; // negative for dashed
        this.symbol = 0;
        this.radius = 3;

        this.skip = 0; // number of elements between ord values
        this.xsub = 0;
        this.ysub = 0;
        this.xdata = false; // true if X data is data from file

        this.options = {};
    }

    /**
     * The graphics structure object used to hold state about the plot.
     *
     * @constructor
     * @memberOf sigplot
     * @private
     */
    function GX() {
        this.xptr = undefined; // xpoints as anything "array-like"...
        this.yptr = undefined; // ypoints as anything "array-like"...

        this.retx = 0.0; // absc coord. at mouse location
        this.rety = 0.0;
        this.xmrk = 0.0; // absc coord of mark
        this.ymrk = 0.0;
        this.aretx = 0.0; // absc coord. at mouse location
        this.arety = 0.0;

        this.xstart = 0.0;
        this.xdelta = 0.0;

        this.panxmin = 0.0;
        this.panxmax = 0.0;
        this.panymin = 0.0;
        this.panymax = 0.0;
        this.xmin = 0.0;
        this.xmax = 0.0;
        this.ymin = 0.0;
        this.ymax = 0.0;
        this.zmin = undefined;
        this.zmax = undefined;
        this.dbmin = 0.0;
        this.pxscl = 0.0;
        this.pyscl = 0.0;
        this.pmt = 0.0;

        this.note = "";
        // this.mouse unnecssary because we don't have res table
        this.format = "";

        this.pl = 0;
        this.pr = 0;
        this.pt = 0;
        this.pb = 0;
        this.px1 = 0; // specifies plotting field
        this.px2 = 0;
        this.py1 = 0;
        this.py2 = 0;

        this.pyl = 0;
        this.pthk = 0; // thickness of pan drag box

        this.modlayer = 0;
        this.modsource = 0;
        this.modified = false;
        this.modmode = 0;

        this.xdiv = 0;
        this.ydiv = 0;

        this.all = false;
        this.expand = false;
        this.cross = false;
        this.grid = true;
        this.gridBackground = undefined;
        this.index = false;
        this.pan = true;
        this.specs = true;
        this.legend = true;
        this.xdata = false;

        this.show_x_axis = true;
        this.show_y_axis = true;
        this.show_readout = true;
        this.hide_note = false;
        this.autohide_readout = false;
        this.autohide_panbars = false;
        this.panning = undefined;
        this.panmode = 0; // TODO Is this a good default value? Where is this
        // changed?
        this.hold = false;

        this.sections = 0; // number of plot sections, -1 for layers
        this.iysec = 0;
        this.nsec = 0; // actual number of sections
        this.isec = 0; // current sections

        this.xlab = undefined;
        this.ylab = undefined;

        this.default_rubberbox_action = "zoom";
        this.default_rubberbox_mode = "box";

        this.wheelscroll_mode_natural = true;
        this.scroll_time_interval = 10;

        this.repeatPanning = undefined;
        this.stillPanning = undefined; // TODO maybe merge this variable with
        // Gx.panning in future?

        this.autol = -1;

        this.lineSmoothing = false; // not implemented
        this.rasterSmoothing = false;

        this.wheelZoom = false;
        this.wheelZoomPercent = 0.2;
        this.inContinuousZoom = false;

        this.lyr = [];
        this.HCB = [];
        this.plugins = [];
                
        this.plotData = document.createElement("canvas");
	this.plotData.valid = false;
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function sigplot_show_x(plot) {
        var Gx = plot._Gx;
        var Mx = plot._Mx;

        var ls = Gx.aretx.toString();
        if (Gx.iabsc === 1) {
            mx.message(Mx, "INDEX = " + ls);
        } else if (Gx.iabsc === 2) {
            mx.message(Mx, "1/X = " + ls);
        } else {
            //if (Gx.xlab === 4) {
            // TODO
            //}
            mx.message(Mx, "X = " + ls);
        }
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function sigplot_show_timecode(plot) {
        var Gx = plot._Gx;
        var Mx = plot._Mx;

        if (Gx.lyr.length > 0) {
            //var hcb = Gx.HCB[Gx.lyr[0].hcb];
            var hcb = Gx.lyr[0].hcb; // mmm-TODO-needs investigation
            if (hcb.xunits === 1) {
                mx.message(Mx, "Time = " + m.sec2tod(hcb.timecode + Gx.retx));
            } else {
                mx.message(Mx, "Time = UNK");
            }

        }

    }

    /**
     * @memberOf sigplot
     * @private
     */
    function sigplot_show_y(plot) {
        var Gx = plot._Gx;
        var Mx = plot._Mx;

        var ls = Gx.arety.toString();
        if (Gx.iabsc === 2) {
            mx.message(Mx, "1/Y = " + ls);
        } else {
            //if (Gx.xlab === 4) {
            // TODO
            //}
            mx.message(Mx, "Y = " + ls);
        }
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function sigplot_show_z(plot) {
        var Gx = plot._Gx;
        var Mx = plot._Mx;

        if (Gx.zmin && Gx.zmax) { // at least one layer has a z dimension
            var msg = "";
            if (Gx.lyr.length === 1) {
                var msg = "Z = " + Gx.lyr[0].get_z(Gx.retx, Gx.rety).toString();
            } else {
                var msg = "TODO"; // TODO we need to think of what we want to display here
            }
            mx.message(Mx, msg);
        }
    }

    /**
     * Constructs a menu for updating the pan scale of the plot.
     *
     * @param plot
     *            The plot to work with.
     * @param command
     *            The scroll direction to use. Either "XPAN" or "YPAN" are
     *            acceptable.
     * @private
     */
    function sigplot_scrollScaleMenu(plot, command) {
        var Mx = plot._Mx;

        mx.removeEventListener(Mx, "mousedown", plot.onmousedown, false);

        mx.menu(Mx, {
            title: "SCROLLBAR",
            refresh: function() {
                plot.refresh();
            },
            finalize: function() {
                mx.addEventListener(Mx, "mousedown",
                    plot.onmousedown, false);
                plot.refresh();
            },
            items: [{
                text: "Expand Range",
                handler: function() {
                    middleClickScrollMenuAction(plot,
                        mx.SB_EXPAND, command);
                }
            }, {
                text: "Shrink Range",
                handler: function() {
                    middleClickScrollMenuAction(plot,
                        mx.SB_SHRINK, command);
                }
            }, {
                text: "Expand Full",
                handler: function() {
                    middleClickScrollMenuAction(plot,
                        mx.SB_FULL, command);
                }
            }]
        });
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function sigplot_mainmenu(plot) {
        var Gx = plot._Gx;
        var Mx = plot._Mx;

        // show mainmenu
        //

        mx.removeEventListener(Mx, "mousedown", plot.onmousedown, false);

        // Sub-menus
        var CONTROLS_MENU = {
            text: "Cntrls...",
            menu: {
                title: "CONTROLS OPTIONS",
                items: [{
                    text: "Continuous (Disabled)",
                    checked: Gx.cntrls === -2,
                    handler: function() {
                        plot.change_settings({
                            xcnt: -2
                        });
                    }
                }, {
                    text: "LM Click (Disabled)",
                    checked: Gx.cntrls === -1,
                    handler: function() {
                        plot.change_settings({
                            xcnt: -1
                        });
                    }
                }, {
                    text: "Off",
                    checked: Gx.cntrls === 0,
                    handler: function() {
                        plot.change_settings({
                            xcnt: 0
                        });
                    }
                }, {
                    text: "LM Click",
                    checked: Gx.cntrls === 1,
                    handler: function() {
                        plot.change_settings({
                            xcnt: 1
                        });
                    }
                }, {
                    text: "Continuous",
                    checked: Gx.cntrls === 2,
                    handler: function() {
                        plot.change_settings({
                            xcnt: 2
                        });
                    }
                }]
            }
        };

        var CXMODE_MENU = {
            text: "CX Mode...",
            menu: {
                title: "COMPLEX MODE",
                items: [{
                    text: "Magnitude",
                    checked: Gx.cmode === 1,
                    handler: function() {
                        plot.change_settings({
                            cmode: 1
                        });
                    }
                }, {
                    text: "Phase",
                    checked: Gx.cmode === 2,
                    handler: function() {
                        plot.change_settings({
                            cmode: 2
                        });
                    }
                }, {
                    text: "Real",
                    checked: Gx.cmode === 3,
                    handler: function() {
                        plot.change_settings({
                            cmode: 3
                        });
                    }
                }, {
                    text: "Imaginary",
                    checked: Gx.cmode === 4,
                    handler: function() {
                        plot.change_settings({
                            cmode: 4
                        });
                    }
                }, {
                    text: "IR: Imag/Real",
                    checked: Gx.cmode === 5,
                    handler: function() {
                        plot.change_settings({
                            cmode: 5
                        });
                    }
                }, {
                    text: "10*Log10",
                    checked: Gx.cmode === 6,
                    handler: function() {
                        plot.change_settings({
                            cmode: 6
                        });
                    }
                }, {
                    text: "20*Log10",
                    checked: Gx.cmode === 7,
                    handler: function() {
                        plot.change_settings({
                            cmode: 7
                        });
                    }
                }]
            }
        };

        var SCALING_MENU = {
            text: "Scaling...",
            menu: {
                title: "SCALING",
                items: [{
                    text: "Y Axis",
                    style: "separator"
                }, {
                    text: "Parameters...",
                    checked: (Gx.autoy === 0),
                    handler: function() {
                        Gx.autoy = 0;

                        var nextPrompt = function() {
                            setupPrompt(
                                plot,
                                "Y Axis Max:",
                                mx.floatValidator,
                                function(finalValue) {
                                    if (parseFloat(finalValue) !== Mx.stk[Mx.level].ymax) {
                                        // Only update if different
                                        // value
                                        if (finalValue === "") {
                                            finalValue = 0;
                                        }
                                        updateViewbox(
                                            plot,
                                            Mx.stk[Mx.level].ymin,
                                            parseFloat(finalValue),
                                            "Y");
                                    } else {
                                        plot.refresh();
                                    }
                                }, Mx.stk[Mx.level].ymax,
                                undefined, undefined, undefined);
                        };

                        setupPrompt(
                            plot,
                            "Y Axis Min:",
                            mx.floatValidator,
                            function(finalValue) {
                                if (parseFloat(finalValue) !== Mx.stk[Mx.level].ymin) {
                                    // Only update if different
                                    // value
                                    if (finalValue === "") {
                                        finalValue = 0;
                                    }
                                    updateViewbox(plot,
                                        parseFloat(finalValue),
                                        Mx.stk[Mx.level].ymax,
                                        "Y");
                                } else {
                                    plot.refresh();
                                }

                            }, Mx.stk[Mx.level].ymin, undefined,
                            undefined, nextPrompt);
                    }
                }, {
                    text: "Min Auto",
                    checked: (Gx.autoy === 1),
                    handler: function() {
                        Gx.autoy = 1;
                    }
                }, {
                    text: "Max Auto",
                    checked: (Gx.autoy === 2),
                    handler: function() {
                        Gx.autoy = 2;
                    }
                }, {
                    text: "Full Auto",
                    checked: (Gx.autoy === 3),
                    handler: function() {
                        Gx.autoy = 3;
                    }
                }, {
                    text: "X Axis",
                    style: "separator"
                }, {
                    text: "Parameters...",
                    checked: (Gx.autox === 0),
                    handler: function() {
                        Gx.autox = 0;

                        var nextPrompt = function() {
                            setupPrompt(
                                plot,
                                "X Axis Max:",
                                mx.floatValidator,
                                function(finalValue) {
                                    if (parseFloat(finalValue) !== Mx.stk[Mx.level].xmax) {
                                        // Only update if different
                                        // value
                                        if (finalValue === "") {
                                            finalValue = 0;
                                        }
                                        updateViewbox(
                                            plot,
                                            Mx.stk[Mx.level].xmin,
                                            parseFloat(finalValue),
                                            "X");
                                    } else {
                                        plot.refresh();
                                    }
                                }, Mx.stk[Mx.level].xmax,
                                undefined, undefined, undefined);
                        };

                        setupPrompt(
                            plot,
                            "X Axis Min:",
                            mx.floatValidator,
                            function(finalValue) {
                                if (parseFloat(finalValue) !== Mx.stk[Mx.level].xmin) {
                                    // Only update if different
                                    // value
                                    if (finalValue === "") {
                                        finalValue = 0;
                                    }
                                    updateViewbox(plot,
                                        parseFloat(finalValue),
                                        Mx.stk[Mx.level].xmax,
                                        "X");
                                } else {
                                    plot.refresh();
                                }
                            }, Mx.stk[Mx.level].xmin, undefined,
                            undefined, nextPrompt);
                    }
                }, {
                    text: "Min Auto",
                    checked: (Gx.autox === 1),
                    handler: function() {
                        Gx.autox = 1;
                    }
                }, {
                    text: "Max Auto",
                    checked: (Gx.autox === 2),
                    handler: function() {
                        Gx.autox = 2;
                    }
                }, {
                    text: "Full Auto",
                    checked: (Gx.autox === 3),
                    handler: function() {
                        Gx.autox = 3;
                    }
                }]
            }
        };

        var GRID_MENU = {
            text: "Grid",
            handler: function() {
                plot.change_settings({
                    grid: !Gx.grid
                });
            }
        };

        var SETTINGS_MENU = {
            text: "Settings...",
            menu: {
                title: "SETTINGS",
                items: [{
                    text: "ALL Mode",
                    checked: Gx.all,
                    style: "checkbox",
                    handler: function() {
                        plot.change_settings({
                            all: !Gx.all
                        });
                    }
                }, {
                    text: "Controls...",
                    menu: {
                        title: "CONTROLS OPTIONS",
                        items: [{
                            text: "Continuous (Disabled)",
                            checked: Gx.cntrls === -2,
                            handler: function() {
                                plot.change_settings({
                                    xcnt: -2
                                });
                            }
                        }, {
                            text: "LM Click (Disabled)",
                            checked: Gx.cntrls === -1,
                            handler: function() {
                                plot.change_settings({
                                    xcnt: -1
                                });
                            }
                        }, {
                            text: "Off",
                            checked: Gx.cntrls === 0,
                            handler: function() {
                                plot.change_settings({
                                    xcnt: 0
                                });
                            }
                        }, {
                            text: "LM Click",
                            checked: Gx.cntrls === 1,
                            handler: function() {
                                plot.change_settings({
                                    xcnt: 1
                                });
                            }
                        }, {
                            text: "Continuous",
                            checked: Gx.cntrls === 2,
                            handler: function() {
                                plot.change_settings({
                                    xcnt: 2
                                });
                            }
                        }]
                    }
                }, {
                    text: "Mouse...",
                    menu: {
                        title: "MOUSE OPTIONS",
                        items: [{
                            text: "LM Drag (Zoom)",
                            checked: Gx.default_rubberbox_action === "zoom",
                            handler: function() {
                                Gx.default_rubberbox_action = "zoom";
                            }
                        }, {
                            text: "LM Drag (Select)",
                            checked: Gx.default_rubberbox_action === "select",
                            handler: function() {
                                Gx.default_rubberbox_action = "select";
                            }
                        }, {
                            text: "LM Drag (Disabled)",
                            checked: Gx.default_rubberbox_action === undefined,
                            handler: function() {
                                Gx.default_rubberbox_action = undefined;
                            }
                        }, {
                            text: "Mode...",
                            menu: {
                                title: "MOUSE Mode",
                                items: [{
                                    text: "Box",
                                    checked: Gx.default_rubberbox_mode === "box",
                                    handler: function() {
                                        Gx.default_rubberbox_mode = "box";
                                    }

                                }, {
                                    text: "Horizontal",
                                    checked: Gx.default_rubberbox_mode === "horizontal",
                                    handler: function() {
                                        Gx.default_rubberbox_mode = "horizontal";
                                    }
                                }, {
                                    text: "Vertical",
                                    checked: Gx.default_rubberbox_mode === "vertical",
                                    handler: function() {
                                        Gx.default_rubberbox_mode = "vertical";
                                    }
                                }]
                            }
                        }, {
                            text: "CROSShairs...",
                            menu: {
                                title: "Crosshairs Mode",
                                items: [{
                                    text: "Off",
                                    checked: !Gx.cross,
                                    handler: function() {
                                        Gx.cross = false;
                                    }

                                }, {
                                    text: "On",
                                    checked: Gx.cross === true,
                                    handler: function() {
                                        Gx.cross = true;
                                    }
                                }, {
                                    text: "Horizontal",
                                    checked: Gx.cross === "horizontal",
                                    handler: function() {
                                        Gx.cross = "horizontal";
                                    }
                                }, {
                                    text: "Vertical",
                                    checked: Gx.cross === "vertical",
                                    handler: function() {
                                        Gx.cross = "vertical";
                                    }
                                }]
                            }
                        }, {
                            text: "Mousewheel Natural Mode",
                            checked: Gx.wheelscroll_mode_natural,
                            style: "checkbox",
                            handler: function() {
                                plot
                                    .change_settings({
                                        wheelscroll_mode_natural: !Gx.wheelscroll_mode_natural
                                    });
                            }
                        }]
                    }
                }, {
                    text: "CROSShairs",
                    checked: Gx.cross,
                    style: "checkbox",
                    handler: function() {
                        plot.change_settings({
                            cross: !Gx.cross
                        });
                    }
                }, {
                    text: "GRID",
                    checked: Gx.grid,
                    style: "checkbox",
                    handler: function() {
                        plot.change_settings({
                            grid: !Gx.grid
                        });
                    }
                }, {
                    text: "INDEX Mode",
                    checked: Gx.index,
                    style: "checkbox",
                    handler: function() {
                        plot.change_settings({
                            index: !Gx.index
                        });
                    }
                }, {
                    text: "LEGEND",
                    checked: Gx.legend,
                    style: "checkbox",
                    handler: function() {
                        plot.change_settings({
                            legend: !Gx.legend
                        });
                    }
                }, {
                    text: "PAN Scrollbars",
                    checked: Gx.pan,
                    style: "checkbox",
                    handler: function() {
                        plot.change_settings({
                            pan: !Gx.pan
                        });
                    }
                }, {
                    text: "PHase UNITS...",
                    menu: {
                        title: "PHASE UNITS",
                        items: [{
                            text: "Radians",
                            checked: Gx.plab === 23,
                            handler: function() {
                                plot.change_settings({
                                    phunits: 'R'
                                });
                            }

                        }, {
                            text: "Degrees",
                            checked: Gx.plab === 24,
                            handler: function() {
                                plot.change_settings({
                                    phunits: 'D'
                                });
                            }
                        }, {
                            text: "Cycles",
                            checked: Gx.plab === 25,
                            handler: function() {
                                plot.change_settings({
                                    phunits: 'C'
                                });
                            }
                        }]
                    }
                }, {
                    text: "SPECS",
                    checked: Gx.specs,
                    style: "checkbox",
                    handler: function() {
                        plot.change_settings({
                            specs: !Gx.specs
                        });
                    }
                }, {
                    text: "XDIVisions...",
                    handler: function() {
                        var validator = function(value) {
                            var isValid = mx.intValidator(value);
                            var maxXDIV = m.trunc(Mx.width / 2); // TODO
                            // Make value an option on the plot?
                            // Maybe still a little too high
                            // while dotted-line grids are
                            // being drawn?
                            if (isValid.valid && value > maxXDIV) {
                                return {
                                    valid: false,
                                    reason: "Exceeds maximum number of divisions (" + maxXDIV + ")."
                                };
                            } else {
                                return isValid;
                            }
                        };

                        setupPrompt(
                            plot,
                            "X Divisions:",
                            validator,
                            function(finalValue) {
                                if (parseFloat(finalValue) !== Gx.xdiv) { // Only
                                    // update if different value
                                    if (finalValue === "") {
                                        finalValue = 1;
                                    }
                                    Gx.xdiv = parseFloat(finalValue);
                                }
                                plot.refresh();

                            }, Gx.xdiv, undefined, undefined,
                            undefined);
                    }
                }, {
                    text: "XLABel...",
                    handler: function() {
                        var validator = function(value) {
                            console.log("The value is " + value);
                            var isValid = mx.intValidator(value);
                            return isValid;
                        };

                        setupPrompt(
                            plot,
                            "X Units:",
                            validator,
                            function(finalValue) {
                                if (parseFloat(finalValue) !== Gx.xlab) { // Only
                                    // update if different value
                                    if (finalValue < 0) {
                                        finalValue = 0;
                                    }
                                    Gx.xlab = parseFloat(finalValue);
                                }
                                plot.refresh();

                            }, Gx.xlab, undefined, undefined,
                            undefined);
                    }
                }, {
                    text: "YDIVisions...",
                    handler: function() {
                        var validator = function(value) {
                            var isValid = mx.intValidator(value);
                            var maxYDIV = m.trunc(Mx.height / 2); // TODO
                            // Make value an option on the plot?
                            // Maybe still a little too high
                            // while dotted-line grids are
                            // being drawn?
                            if (isValid.valid && value > maxYDIV) {
                                return {
                                    valid: false,
                                    reason: "Exceeds maximum number of divisions (" + maxYDIV + ")."
                                };
                            } else {
                                return isValid;
                            }
                        };

                        setupPrompt(
                            plot,
                            "Y Divisions:",
                            validator,
                            function(finalValue) {
                                if (parseFloat(finalValue) !== Gx.ydiv) {
                                    // Only update if different
                                    // value
                                    if (finalValue === "") {
                                        finalValue = 1;
                                    }
                                    Gx.ydiv = parseFloat(finalValue);
                                }
                                plot.refresh();

                            }, Gx.ydiv, undefined, undefined,
                            undefined);
                    }
                }, {
                    text: "YINVersion",
                    checked: (Mx.origin === 4),
                    style: "checkbox",
                    handler: function() {
                        plot.change_settings({
                            yinv: (Mx.origin !== 4)
                        });
                    }
                }, {
                    text: "YLABel...",
                    handler: function() {
                        var validator = function(value) {
                            var isValid = mx.intValidator(value);
                            return isValid;
                        };

                        setupPrompt(
                            plot,
                            "Y Units:",
                            validator,
                            function(finalValue) {
                                if (parseFloat(finalValue) !== Gx.ylab) { // Only
                                    // update if different value
                                    if (finalValue < 0) {
                                        finalValue = 0;
                                    }
                                    Gx.ylab = parseFloat(finalValue);
                                }
                                plot.refresh();

                            }, Gx.ylab, undefined, undefined,
                            undefined);
                    }
                }, {
                    text: "X-axis",
                    checked: Gx.show_x_axis,
                    style: "checkbox",
                    handler: function() {
                        plot.change_settings({
                            show_x_axis: !Gx.show_x_axis
                        });
                    }
                }, {
                    text: "Y-axis",
                    checked: Gx.show_y_axis,
                    style: "checkbox",
                    handler: function() {
                        plot.change_settings({
                            show_y_axis: !Gx.show_y_axis
                        });
                    }
                }, {
                    text: "Readout",
                    checked: Gx.show_readout,
                    style: "checkbox",
                    handler: function() {
                        plot.change_settings({
                            show_readout: !Gx.show_readout
                        });
                    }
                }, {
                    text: "Invert Colors",
                    checked: Mx.xi,
                    style: "checkbox",
                    handler: function() {
                        mx.invertbgfg(Mx);
                    }
                }]
            }
        };

        var COLORMAP_MENU = {
            text: "Colormap...",
            menu: {
                title: "COLORMAP",
                items: [{
                    text: "Greyscale",
                    checked: (Gx.cmap === 0),
                    handler: function() {
                        plot.change_settings({
                            cmap: 0
                        });
                    }
                }, {
                    text: "Ramp Colormap",
                    checked: (Gx.cmap === 1),
                    handler: function() {
                        plot.change_settings({
                            cmap: 1
                        });
                    }
                }, {
                    text: "Color Wheel",
                    checked: (Gx.cmap === 2),
                    handler: function() {
                        plot.change_settings({
                            cmap: 2
                        });
                    }
                }, {
                    text: "Spectrum",
                    checked: (Gx.cmap === 3),
                    handler: function() {
                        plot.change_settings({
                            cmap: 3
                        });
                    }
                }, {
                    text: "Sunset",
                    checked: (Gx.cmap === 4),
                    handler: function() {
                        plot.change_settings({
                            cmap: 4
                        });
                    }
                }]
            }
        };

        var traceoptionsmenu = function(index) {
            return {
                title: "TRACE OPTIONS",
                items: [{
                    text: "Dashed...",
                    handler: function() {
                        // Figure out the current thickness
                        var thk = 1;
                        if (index !== undefined) {
                            thk = Math.abs(plot._Gx.lyr[index].thick);
                        } else {
                            if (Gx.lyr.length === 0) { return; }

                            thk = Math.abs(plot._Gx.lyr[0].thick);
                            for (var i = 0; i < Gx.lyr.length; i++) {
                                if (thk !== Math.abs(plot._Gx.lyr[i].thick)) {
                                    thk = 1;
                                    break;
                                }
                            }
                        }
                        setupPrompt(
                            plot,
                            "Line thickness:",
                            mx.intValidator, function(finalValue) {
                                if (index !== undefined) {
                                    plot._Gx.lyr[index].line = 3;
                                    plot._Gx.lyr[index].thick = -1 * finalValue;
                                    plot._Gx.lyr[index].symbol = 0;
                                } else {
                                    for (var index = 0; index < Gx.lyr.length; index++) {
                                        plot._Gx.lyr[index].line = 3;
                                        plot._Gx.lyr[index].thick = -1 * finalValue;
                                        plot._Gx.lyr[index].symbol = 0;
                                    }
                                }
                            }, thk);
                    }
                }, {
                    text: "Dots...",
                    handler: function() {
                        // Figure out the current thickness
                        var radius = 3;
                        if (index !== undefined) {
                            radius = Math.abs(plot._Gx.lyr[index].radius);
                        } else {
                            if (Gx.lyr.length === 0) { return; }
                            for (var i = 0; i < Gx.lyr.length; i++) {
                                if (radius !== Math.abs(plot._Gx.lyr[i].radius)) {
                                    radius = 3;
                                    break;
                                }
                            }
                        }
                        setupPrompt(
                            plot,
                            "Radius/Shape:",
                            mx.intValidator, function(finalValue) {
                                var sym;
                                var rad;
                                if (finalValue < 0) {
                                    sym = 3; // square
                                    rad = Math.abs(finalValue);
                                } else if (finalValue > 0) {
                                    sym = 2; // circle
                                    rad = finalValue;
                                } else {
                                    sym = 1;
                                    rad = 0;
                                }
                                if (index !== undefined) {
                                    plot._Gx.lyr[index].line = 0;
                                    plot._Gx.lyr[index].radius = rad;
                                    plot._Gx.lyr[index].symbol = sym;
                                } else {
                                    for (var i = 0; i < Gx.lyr.length; i++) {
                                        plot._Gx.lyr[i].line = 0;
                                        plot._Gx.lyr[i].radius = rad;
                                        plot._Gx.lyr[i].symbol = sym;
                                    }
                                }
                            }, radius);
                    }
                }, {
                    text: "Solid...",
                    handler: function() {
                        // Figure out the current thickness
                        var thk = 1;
                        if (index !== undefined) {
                            thk = Math.abs(plot._Gx.lyr[index].thick);
                        } else {
                            if (Gx.lyr.length === 0) { return; }

                            thk = Math.abs(plot._Gx.lyr[0].thick);
                            for (var i = 0; i < Gx.lyr.length; i++) {
                                if (thk !== Math.abs(plot._Gx.lyr[i].thick)) {
                                    thk = 1;
                                    break;
                                }
                            }
                        }
                        setupPrompt(
                            plot,
                            "Line thickness:",
                            mx.intValidator, function(finalValue) {
                                if (index !== undefined) {
                                    plot._Gx.lyr[index].line = 3;
                                    plot._Gx.lyr[index].thick = finalValue;
                                    plot._Gx.lyr[index].symbol = 0;
                                } else {
                                    for (var i = 0; i < Gx.lyr.length; i++) {
                                        plot._Gx.lyr[i].line = 3;
                                        plot._Gx.lyr[i].thick = finalValue;
                                        plot._Gx.lyr[i].symbol = 0;
                                    }
                                }
                            }, thk);
                    }
                }, {
                    text: "Toggle",
                    style: (index !== undefined) ? "checkbox" : undefined,
                    checked: (index !== undefined) ? plot._Gx.lyr[index].display : undefined,
                    handler: function() {
                        if (index !== undefined) {
                            plot._Gx.lyr[index].display = !plot._Gx.lyr[index].display;
                        } else {
                            for (var i = 0; i < Gx.lyr.length; i++) {
                                plot._Gx.lyr[i].display = !plot._Gx.lyr[i].display;
                            }
                        }
                    }
                }, {
                    text: "Symbols...",
                    menu: {
                        title: "SYMBOLS",
                        items: [{
                            text: "Retain Current"
                        }, {
                            text: "None",
                            checked: (index !== undefined) ? plot._Gx.lyr[index].symbol === 0 : undefined,
                            handler: function() {
                                if (index !== undefined) {
                                    plot._Gx.lyr[index].radius = 0;
                                    plot._Gx.lyr[index].symbol = 0;
                                } else {
                                    for (var i = 0; i < Gx.lyr.length; i++) {
                                        plot._Gx.lyr[i].radius = 0;
                                        plot._Gx.lyr[i].symbol = 0;
                                    }
                                }
                            }
                        }, {
                            text: "Pixels",
                            checked: (index !== undefined) ? plot._Gx.lyr[index].symbol === 1 : undefined,
                            handler: function() {
                                if (index !== undefined) {
                                    plot._Gx.lyr[index].radius = 1;
                                    plot._Gx.lyr[index].symbol = 1;
                                } else {
                                    for (var i = 0; i < Gx.lyr.length; i++) {
                                        plot._Gx.lyr[i].radius = 1;
                                        plot._Gx.lyr[i].symbol = 1;
                                    }
                                }
                            }
                        }, {
                            text: "Circles",
                            checked: (index !== undefined) ? plot._Gx.lyr[index].symbol === 2 : undefined,
                            handler: function() {
                                if (index !== undefined) {
                                    plot._Gx.lyr[index].radius = 4;
                                    plot._Gx.lyr[index].symbol = 2;
                                } else {
                                    for (var i = 0; i < Gx.lyr.length; i++) {
                                        plot._Gx.lyr[i].radius = 4;
                                        plot._Gx.lyr[i].symbol = 2;
                                    }
                                }
                            }
                        }, {
                            text: "Squares",
                            checked: (index !== undefined) ? plot._Gx.lyr[index].symbol === 3 : undefined,
                            handler: function() {
                                if (index !== undefined) {
                                    plot._Gx.lyr[index].radius = 4;
                                    plot._Gx.lyr[index].symbol = 3;
                                } else {
                                    for (var i = 0; i < Gx.lyr.length; i++) {
                                        plot._Gx.lyr[i].radius = 4;
                                        plot._Gx.lyr[i].symbol = 3;
                                    }
                                }
                            }
                        }, {
                            text: "Plusses",
                            checked: (index !== undefined) ? plot._Gx.lyr[index].symbol === 4 : undefined,
                            handler: function() {
                                if (index !== undefined) {
                                    plot._Gx.lyr[index].radius = 4;
                                    plot._Gx.lyr[index].symbol = 4;
                                } else {
                                    for (var i = 0; i < Gx.lyr.length; i++) {
                                        plot._Gx.lyr[i].radius = 4;
                                        plot._Gx.lyr[i].symbol = 4;
                                    }
                                }
                            }
                        }, {
                            text: "X's",
                            checked: (index !== undefined) ? plot._Gx.lyr[index].symbol === 5 : undefined,
                            handler: function() {
                                if (index !== undefined) {
                                    plot._Gx.lyr[index].radius = 4;
                                    plot._Gx.lyr[index].symbol = 5;
                                } else {
                                    for (var i = 0; i < Gx.lyr.length; i++) {
                                        plot._Gx.lyr[i].radius = 4;
                                        plot._Gx.lyr[i].symbol = 5;
                                    }
                                }
                            }
                        }, {
                            text: "Triangles",
                            checked: (index !== undefined) ? plot._Gx.lyr[index].symbol === 6 : undefined,
                            handler: function() {
                                if (index !== undefined) {
                                    plot._Gx.lyr[index].radius = 6;
                                    plot._Gx.lyr[index].symbol = 6;
                                } else {
                                    for (var i = 0; i < Gx.lyr.length; i++) {
                                        plot._Gx.lyr[i].radius = 6;
                                        plot._Gx.lyr[i].symbol = 6;
                                    }
                                }
                            }
                        }, {
                            text: "Downward Triangles",
                            checked: (index !== undefined) ? plot._Gx.lyr[index].symbol === 7 : undefined,
                            handler: function() {
                                if (index !== undefined) {
                                    plot._Gx.lyr[index].radius = 6;
                                    plot._Gx.lyr[index].symbol = 7;
                                } else {
                                    for (var i = 0; i < Gx.lyr.length; i++) {
                                        plot._Gx.lyr[i].radius = 6;
                                        plot._Gx.lyr[i].symbol = 7;
                                    }
                                }
                            }
                        }]
                    }
                }, {
                    text: "Line Type...",
                    menu: {
                        title: "LINE TYPE",
                        items: [{
                            text: "Retain Current"
                        }, {
                            text: "None",
                            checked: (index !== undefined) ? plot._Gx.lyr[index].line === 0 : undefined,
                            handler: function() {
                                if (index !== undefined) {
                                    plot._Gx.lyr[index].line = 0;
                                } else {
                                    for (var i = 0; i < Gx.lyr.length; i++) {
                                        plot._Gx.lyr[i].line = 0;
                                    }
                                }
                            }
                        }, {
                            text: "Verticals",
                            checked: (index !== undefined) ? plot._Gx.lyr[index].line === 1 : undefined,
                            handler: function() {
                                if (index !== undefined) {
                                    plot._Gx.lyr[index].line = 1;
                                } else {
                                    for (var i = 0; i < Gx.lyr.length; i++) {
                                        plot._Gx.lyr[i].line = 1;
                                    }
                                }
                            }
                        }, {
                            text: "Horizontals",
                            checked: (index !== undefined) ? plot._Gx.lyr[index].line === 2 : undefined,
                            handler: function() {
                                if (index !== undefined) {
                                    plot._Gx.lyr[index].line = 2;
                                } else {
                                    for (var i = 0; i < Gx.lyr.length; i++) {
                                        plot._Gx.lyr[i].line = 2;
                                    }
                                }
                            }
                        }, {
                            text: "Connecting",
                            checked: (index !== undefined) ? plot._Gx.lyr[index].line === 3 : undefined,
                            handler: function() {
                                if (index !== undefined) {
                                    plot._Gx.lyr[index].line = 3;
                                } else {
                                    for (var i = 0; i < Gx.lyr.length; i++) {
                                        plot._Gx.lyr[i].line = 3;
                                    }
                                }
                            }
                        }]
                    }
                }, {
                    text: "Thickness...",
                    handler: function() {
                        var thickness = 1;
                        if (index !== undefined) {
                            thickness = plot._Gx.lyr[index].thick;
                        }
                        setupPrompt(
                            plot,
                            "Thickness",
                            mx.intValidator,
                            function(finalValue) {
                                if (finalValue === "") {
                                    finalValue = 1;
                                }
                                finalValue = Math.max(0, finalValue);

                                if (index !== undefined) {
                                    plot._Gx.lyr[index].thick = finalValue;
                                } else {
                                    for (var i = 0; i < Gx.lyr.length; i++) {
                                        plot._Gx.lyr[i].thick = finalValue;
                                    }
                                }
                            }, thickness, undefined,
                            undefined, undefined);
                    }
                }, {
                    text: "Opacity...",
                    handler: function() {
                        var opacity = 1.0;
                        if (index !== undefined) {
                            opacity = plot._Gx.lyr[index].opacity;
                        }
                        setupPrompt(
                            plot,
                            "Opacity:",
                            mx.floatValidator,
                            function(finalValue) {
                                if (finalValue === "") {
                                    finalValue = 1.0;
                                }
                                finalValue = Math.max(0, finalValue);
                                finalValue = Math.min(1, finalValue);

                                if (index !== undefined) {
                                    plot._Gx.lyr[index].opacity = finalValue;
                                } else {
                                    for (var i = 0; i < Gx.lyr.length; i++) {
                                        plot._Gx.lyr[i].opacity = finalValue;
                                    }
                                }
                            }, opacity, undefined,
                            undefined, undefined);
                    }
                }]
            };
        };

        var TRACES_MENU = {
            text: "Traces...",
            menu: function() {
                var Gx = plot._Gx;
                var tracemenu = {
                    title: "TRACE",
                    items: []
                };
                // Add the ALL option
                tracemenu.items.push({
                    text: "All",
                    menu: traceoptionsmenu()
                });
                // Add all the active layers
                for (var i = 0; i < Gx.lyr.length; i++) {
                    tracemenu.items.push({
                        text: Gx.lyr[i].name,
                        menu: traceoptionsmenu(i)
                    });
                }
                return tracemenu;
            }
        };

        var FILES_MENU = {
            text: "Files...",
            menu: {
                title: "FILES OPTIONS",
                items: [
                    // Overlay File... is disabled
                    // because it's actually very
                    // difficult to bring up a
                    // a file upload browse dialog
                    /*
                     * { text: "Overlay File...", handler: function() {
                     * plot.change_settings( {phunits: 'R'} ); } },
                     */
                    {
                        text: "Deoverlay File...",
                        menu: function() {
                            var Gx = plot._Gx;
                            var deoverlaymenu = {
                                title: "DEOVERLAY",
                                items: []
                            };
                            deoverlaymenu.items.push({
                                text: "Deoverlay All",
                                handler: function() {
                                    plot.deoverlay();
                                }
                            });
			    /* jshint -W083 */
			    /* TODO figure out how to not create functions within a loop */
                            for (var i = 0; i < Gx.lyr.length; i++) {
                                var handler = (function(index) {
                                    return function() {
                                        plot.deoverlay(index);
                                    };
                                }(i));

                                deoverlaymenu.items.push({
                                    text: Gx.lyr[i].name,
                                    handler: handler
                                });
                            }
			    /* jshint +W083 */
                            return deoverlaymenu;
                        }
                    }
                ]
            }
        };

        var PLUGINS_MENU = {
            text: "Plugins...",
            menu: {
                title: "PLUGINS",
                items: (function() { // Immediately
                    // Invoked
                    // Function
                    var result = [];
                    for (var i = 0; i < Gx.plugins.length; i++) {
                        var plugin = Gx.plugins[i];
                        if (plugin.impl.menu) {
                            if (typeof plugin.impl.menu === 'function') {
                                result.push(plugin.impl.menu());
                            } else {
                                result.push(plugin.impl.menu);
                            }
                        }
                    }
                    return result;
                }())
            }
        };

        var REFRESH_ITEM = {
            text: "Refresh" // no handler, just let the finalizer deal with
            // it
        };

        var KEYPRESSINFO_ITEM = {
            text: "Keypress Info",
            handler: function() {
                mx.message(Mx, KEYPRESS_HELP);
            }
        };

        var EXIT_ITEM = {
            text: "Exit",
            handler: function() {
                var evt = document.createEvent('Event');
                evt.initEvent('sigplotexit', true, true);
                mx.dispatchEvent(Mx, evt);
            }
        };

        // Main Menu
        var MAINMENU = {
            title: "SIG-PLOT",
            finalize: function() {
                if (!Mx.prompt) {
                    // A prompt may have been
                    // created by a menu handler
                    // - let it deal with
                    // eventListener re-setting
                    mx.addEventListener(Mx, "mousedown", plot.onmousedown,
                        false);
                }
                plot.refresh();
            },
            items: [REFRESH_ITEM, CONTROLS_MENU, CXMODE_MENU, SCALING_MENU,
                GRID_MENU, SETTINGS_MENU, COLORMAP_MENU, TRACES_MENU, FILES_MENU,
                PLUGINS_MENU, KEYPRESSINFO_ITEM, EXIT_ITEM
            ]
        };

        mx.menu(Mx, MAINMENU);
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function rubberbox_cb(plot) {
        return function(event, xo, yo, xl, yl, action) {
            var Gx = plot._Gx;
            var Mx = plot._Mx;

            var x = Math.min(xo, xl);
            var y = Math.min(yo, yl);
            var w = Math.abs(xl - xo);
            var h = Math.abs(yl - yo);

            if ((action === undefined) || (action === "zoom")) {
                if (event.which === 1) {
                    // On some browsers, a click will actually be sent as
                    // mousedown/mousemove/mouseup so
                    // don't make insanely small zooms...instead treat them as a
                    // click
                    if ((w < 2) && (h < 2)) {
                        var inCenter = inPanCenterRegion(plot);
                        if (inCenter.inCenterRegion) {
                            // console.log("!!!MOUSEUP in
                            // PAN_CENTER_REGION!!!");
                            // event.preventDefault(); // TODO Necessary?
                            if (inCenter.command !== ' ') {
                                pan(plot, inCenter.command, 0, event); // pan
                            }
                        } else if (Gx.cntrls === 1) {
                            var evt = document.createEvent('Event');
                            evt.initEvent('mtag', true, true);
                            evt.x = Gx.xmrk;
                            evt.y = Gx.ymrk;
                            evt.w = undefined;
                            evt.h = undefined;
                            mx.dispatchEvent(Mx, evt);
                        }
                        return;
                    }
                    plot.pixel_zoom(xo, yo, xl, yl);
                    plot.refresh();
                }
            } else if (action === "select") {
                var evt = document.createEvent('Event');
                evt.initEvent('mtag', true, true);
                var re = pixel_to_real(plot, x, y);
                var rwh = pixel_to_real(plot, x + w, y + h);
                evt.x = re.x;
                evt.y = re.y;
                evt.w = Math.abs(rwh.x - re.x);
                evt.h = Math.abs(rwh.y - re.y);
                mx.dispatchEvent(Mx, evt);
            }
        };
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function plot_init(plot, o) {
        var Mx = plot._Mx;
        var Gx = plot._Gx;

        // Equivalent to reading cmd line args
        Gx.xmin = o.xmin === undefined ? 0.0 : o.xmin;
        Gx.xmax = o.xmax === undefined ? 0.0 : o.xmax;
        var havexmin = (o.xmin !== undefined);
        var havexmax = (o.xmax !== undefined);
        var address = o.cmode === undefined ? "" : o.cmode.toUpperCase();
        var line = o.line === undefined ? 3 : o.line;
        Gx.ylab = o.ylab;
        Gx.ymin = o.ymin === undefined ? 0.0 : o.ymin;
        Gx.ymax = o.ymax === undefined ? 0.0 : o.ymax;
        var haveymin = (o.ymin !== undefined);
        var haveymax = (o.ymax !== undefined);

        if (o.colors !== undefined) {
            mx.setbgfg(Mx, o.colors.bg, o.colors.fg, Mx.xi);
        }

        if (o.xi !== undefined) {
            mx.invertbgfg(Mx);
        }

        Gx.forcelab = o.forcelab === undefined ? true : o.forcelab;

        Gx.all = o.all === undefined ? false : o.all;
        // By default, SIGPLOT auto-scales only on the first buffer size.
        // "expand" is a feature added for websigplot that when
        // combined with "all" will expand the y-range automaticall
        // to accomodate all of the samples
        Gx.expand = o.expand === undefined ? false : o.expand;

        // TODO Gx.mimic = M$GET_SWITCH ('MIMIC')
        Gx.xlab = o.xlab;
        Gx.segment = o.segment === undefined ? false : o.segment;
        Gx.plab = 24;

        var phunits = (o.phunits === undefined) ? 'D' : o.phunits;
        if (phunits[0] === 'R') {
            Gx.plab = 23;
        } else if (phunits[0] === 'C') {
            Gx.plab = 25;
        }
        Gx.xdiv = o.xdiv === undefined ? 5 : o.xdiv;
        Gx.ydiv = o.ydiv === undefined ? 5 : o.ydiv;

        Mx.origin = 1;
        if (o.yinv) {
            Mx.origin = 4;
        }
        Gx.pmt = o.pmt === undefined ? 1.0 : o.pmt;
        Gx.bufmax = o.bufmax === undefined ? 32768 : o.bufmax;
        Gx.sections = o.nsec === undefined ? 0 : o.nsec;
        Gx.anno_type = o.anno_type === undefined ? 0 : o.anno_type;

        Gx.xfmt = o.xfmt === undefined ? "" : o.xfmt;
        Gx.yfmt = o.yfmt === undefined ? "" : o.yfmt;

        // TODO Gx.xf.msgid = M$GET_SWITCH ('MSGID')
        // Gx.xf.msgmask = max (0, M$GET_SWITCH ('MASK'))

        Gx.index = o.index === undefined ? false : o.index;
        var imode = (Gx.index || (address.slice(0, 2) === "IN"));
        if (imode) {
            if (havexmin && (Gx.xmin === 1.0)) {
                havexmin = false;
            }
            if (havexmax && (Gx.xmin === 1.0)) {
                havexmax = false;
            }
        }

        Gx.yptr = undefined;
        Gx.xptr = undefined;
        Gx.pointbufsize = 0;
        Gx.xdata = false;
        Gx.note = "";
        Gx.hold = 0;

        m.vstype('D');

        if (!o.inputs) {
            basefile(plot, false);
        } else {
            // TODO load files
        }

        var cmode = address.slice(0, 2);
        if (cmode === "IN" || cmode === "AB" || cmode === "__") {
            cmode = address.slice(2, 4);
        }

        // TODO
        if ((Gx.lyr.length > 0) && (Gx.lyr[0].cx)) {
            Gx.cmode = 1;
        } else {
            Gx.cmode = 3;
        }

        if (cmode === "MA") {
            Gx.cmode = 1;
        }
        if (cmode === "PH") {
            Gx.cmode = 2;
        }
        if (cmode === "RE") {
            Gx.cmode = 3;
        }
        if (cmode === "IM") {
            Gx.cmode = 4;
        }
        if ((cmode === "LO") || (cmode === "D1")) {
            Gx.cmode = 6;
        }
        if ((cmode === "L2") || (cmode === "D2")) {
            Gx.cmode = 7;
        }
        if ((cmode === "RI") || (cmode === "IR")) {
            if (Gx.index) {
                alert("Imag/Real mode not permitted in INDEX mode");
            } else {
                Gx.cmode = 5;
            }
        }
        Gx.basemode = Gx.cmode;
        plot.change_settings({
            cmode: Gx.cmode
        });

        // if ( (Gx.forcelab) .and. (Gx.xlab .le. 0) .and.
        // & (Gx.ylab .le. 0) ) then
        // call M$WARNING
        // & ('/xlab or /ylab is missing with /forcelab usage')
        // Gx.forcelab = .false.
        // endif

        Gx.dbmin = 1.0e-20;
        if (Gx.cmode >= 6) {
            var dbscale = 10.0;
            if (Gx.cmode === 7) {
                dbscale = 20.0;
            }
            if (cmode[0] === "L") {
                if ((Gx.lyr.length > 0) && (Gx.lyr[0].cx)) {
                    Gx.ymin = Math.max(Gx.ymin, 1e-10);
                    Gx.ymax = Math.max(Gx.ymax, 1e-10);
                } else {
                    Gx.ymin = Math.max(Gx.ymin, 1e-20);
                    Gx.ymax = Math.max(Gx.ymax, 1e-20);
                }
            } else if ((Gx.lyr.length > 0) && (Gx.lyr[0].cx)) {
                Gx.ymin = Math.max(-18.0 * dbscale, Gx.ymin);
                Gx.ymax = Math.max(-18.0 * dbscale, Gx.ymax);
                Gx.dbmin = 1e-37;
            } else if (Math.min(Gx.ymin, Gx.ymax) < -20.0 * dbscale) {
                Gx.ymin = Math.max(-37.0 * dbscale, Gx.ymin);
                Gx.ymax = Math.max(-37.0 * dbscale, Gx.ymax);
                Gx.dbmin = Math.pow(10, Math.min(Gx.ymin, Gx.ymax) / dbscale);
            }
        }

        Mx.level = 0;
        if (imode && !Gx.index) {
            if (havexmin) {
                Gx.xmin = Gx.xstart + Gx.xdelta * (Gx.xmin - 1.0);
            }
            if (havexmin) {
                Gx.xmax = Gx.xstart + Gx.xdelta * (Gx.xmax - 1.0);
            }
        }
        Gx.autox = o.autox === undefined ? -1 : o.autox;
        if (Gx.autox < 0) {
            Gx.autox = 0;
            if (!havexmin) {
                Gx.autox += 1;
            }
            if (!havexmax) {
                Gx.autox += 2;
            }
        }
        Gx.autoy = o.autoy === undefined ? -1 : o.autoy;
        if (Gx.autoy < 0) {
            Gx.autoy = 0;
            if (!haveymin) {
                Gx.autoy += 1;
            }
            if (!haveymax) {
                Gx.autoy += 2;
            }
        }
        Gx.autol = o.autol === undefined ? -1 : o.autol;

        if (!havexmin) {
            Gx.xmin = undefined;
        }
        if (!havexmax) {
            Gx.xmax = undefined;
        }
        scale_base(plot, {
            get_data: true
        }, Gx.xmin, Gx.xmax, Gx.xlab, Gx.ylab);

        if (!havexmin) {
            Gx.xmin = Mx.stk[0].xmin;
        }
        if (!havexmax) {
            Gx.xmax = Mx.stk[0].xmax;
        }
        if (!haveymin) {
            Gx.ymin = Mx.stk[0].ymin;
        }
        if (!haveymax) {
            Gx.ymax = Mx.stk[0].ymax;
        }

        if (Gx.xmin > Gx.xmax) {
            Mx.stk[0].xmin = Gx.xmax;
            Gx.xmax = Gx.xmin;
            Gx.xmin = Mx.stk[0].xmin;
        }
        if (Gx.ymin > Gx.ymax) {
            Mx.stk[0].ymin = Gx.ymax;
            Gx.ymax = Gx.ymin;
            Gx.ymin = Mx.stk[0].ymin;
        }
        Mx.stk[0].xmin = Gx.xmin;
        Mx.stk[0].xmax = Gx.xmax;
        Mx.stk[0].ymin = Gx.ymin;
        Mx.stk[0].ymax = Gx.ymax;
        Gx.panxmin = Math.min(Gx.panxmin, Gx.xmin);
        Gx.panxmax = Math.max(Gx.panxmax, Gx.xmax);
        Gx.panymin = Math.min(Gx.panymin, Gx.ymin);
        Gx.panymax = Math.max(Gx.panymax, Gx.ymax);

        Gx.xmin = Mx.stk[0].xmin;
        Gx.ymin = Mx.stk[0].ymin;

        mx.set_font(Mx, Math.min(7, Mx.width / 64));

        Gx.ncolors = o.ncolors === undefined ? 16 : o.ncolors;
        Gx.cmap = o.xc === undefined ? -1 : o.xc;
        if (Gx.ncolors < 0) {
            Gx.ncolors = -1 * Gx.ncolors;
            Gx.cmap = Math.max(1, Gx.cmap);
        }
        if ((Gx.cmap < 1) || (Gx.cmap > 5)) {
            if (Gx.cmode === 2) {
                Gx.cmap = 2; // wheel
            } else {
                Gx.cmap = 1; // ramp
            }
        }

        mx.colormap(Mx, m.Mc.colormap[Gx.cmap], Gx.ncolors);


        // TODO setup annotate, boxes and points facilities

        // TODO initialize layer structure line types

        if (o.xcnt === "leftmouse") {
            Gx.cntrls = 1;
        } else if (o.xcnt === "continuous") {
            Gx.cntrls = 2;
        } else {
            Gx.cntrls = o.xcnt === undefined ? 1 : o.xcnt;
        }

        Gx.default_rubberbox_mode = o.rubberbox_mode === undefined ? "box" : o.rubberbox_mode;
        Gx.default_rubberbox_action = o.rubberbox_action === undefined ? "zoom" : o.rubberbox_action;

        Gx.cross = o.cross === undefined ? false : o.cross;
        Gx.grid = o.nogrid === undefined ? true : !o.nogrid;
        Gx.gridBackground = o.gridBackground;
        Gx.gridStyle = o.gridStyle;
        Gx.wheelZoom = o.wheelZoom;
        Gx.wheelZoomPercent = o.wheelZoomPercent;
        Gx.legend = o.legend === undefined ? false : o.legend;
        Gx.legendBtnLocation = {
            x: 0,
            y: 0,
            width: 0,
            height: 0
        };
        Gx.pan = o.nopan === undefined ? true : !o.nopan;
        Gx.nomenu = o.nomenu === undefined ? false : o.nomenu;

        // TODO Gx.lmap.ip = 0
        Gx.modmode = 0;
        Gx.modlayer = -1; // 0-based indexing instead of 1
        Gx.modsource = 0;
        Gx.modified = (o.mod && Gx.lyr.length > 0);
        // TODO Gx.marks(5) = 5
        Gx.nmark = 0;
        Gx.iabsc = 0;
        if (Gx.index) {
            Gx.iabsc = 1;
        }
        // TODO if (o.specs > 0) Gx.iabsc = M$SEARCH('IRS',c(1:1))
        Gx.specs = !o.nospecs;

        Gx.scroll_time_interval = o.scroll_time_interval === undefined ? Gx.scroll_time_interval : o.scroll_time_interval;

        Gx.autohide_readout = o.autohide_readout;
        Gx.autohide_panbars = o.autohide_panbars;
        if (Gx.specs) {
            Gx.show_x_axis = !o.noxaxis;
            Gx.show_y_axis = !o.noyaxis;
            Gx.show_readout = !o.noreadout;
            if (Gx.show_x_axis || Gx.show_y_axis || Gx.show_readout) {
                Gx.specs = true;
            } else {
                Gx.specs = false;
            }
        } else {
            Gx.show_x_axis = false;
            Gx.show_y_axis = false;
            Gx.show_readout = false;
        }
        Gx.hide_note = o.hide_note || false;

        Gx.xmrk = 0.0;
        Gx.ymrk = 0.0;

        if (!o.nodragdrop) {
            mx.addEventListener(Mx, "dragover", function(evt) {
                evt.preventDefault();
            }, false);

            mx.addEventListener(Mx, "drop", (function(plot) {
                return function(evt) {
                    var files = evt.dataTransfer.files;
                    if (files.length > 0) {
                        evt.preventDefault();
                        plot.load_files(files);
                    }
                };
            }(plot)), false);
        }
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function basefile(plot, open) {
        var Gx = plot._Gx;
        var Mx = plot._Mx;
        // != BASEFILE(false)

        // unlike SIGPLOT, where if Gx.index == 1
        // then xstart = 1.0 and xdelta = 1.0...technically
        // Gx.retx is supposed to be the real X coordinate
        // and Gx.aretx is supposed to be the X coordinate in the
        // current abscissa mode
        if (open) {
            var hcb = Gx.HCB[0];
            Gx.xstart = hcb.xstart;
            Gx.xdelta = hcb.xdelta;
            Mx.origin = 1;
        } else {
            Gx.xstart = 0.0;
            Gx.xdelta = 1.0;
            Gx.autol = -1;
            Gx.zmin = undefined;
            Gx.zmax = undefined;
            Mx.origin = 1;
        }

        // if (!open) {
        // Gx.lay[0].cx = false;
        // }
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function draw_accessories(plot, mode) {
        var Mx = plot._Mx;
        var Gx = plot._Gx;
        if (mode > 0) {
            if ((mode >= 4) && (Gx.show_readout) && (!Gx.hide_note)) {
                var ln = Gx.note.length;
                mx.text(Mx, Mx.width - Gx.lbtn - (ln + 1) * Mx.text_w,
                    Mx.text_h, Gx.note);
            }
            if (mode >= 4) {
                draw_panbars(plot);
            }
            if ((mode >= 1) && (Gx.legend)) {
                draw_legend(plot);
            }
        }
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function draw_plugins(plot) {
        var Gx = plot._Gx;
        var ctx = plot._Mx.canvas.getContext("2d");
	var canvas;

        var plugin_index = 0;
        while (plugin_index < Gx.plugins.length) {
            var plugin = Gx.plugins[plugin_index].impl;
            if (plugin.refresh) {
                canvas = Gx.plugins[plugin_index].canvas;
                canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
                Gx.plugins[plugin_index].impl.refresh(canvas);
                ctx.drawImage(canvas, 0, 0);
            }
            plugin_index = plugin_index + 1;
        }
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function draw_legend(plot) {
        var Mx = plot._Mx;
        var Gx = plot._Gx;
        var ctx = Mx.canvas.getContext("2d");

        var n = 0; // integer*4
        var ix = 0; // integer*4
        var iy = 0; // integer*4
        var ln = 0; // integer*4
        var tw = 0; // integer*4
        var xc = 0; // integer*4
        var yc = 0; // integer*4
        var xs = 0; // integer*4
        var ys = 0; // integer*4
        var thk = 0; // integer*4
        var ic = 0; // integer*4

        tw = Mx.text_w;
        xs = tw * 23;
        ys = (Gx.lyr.length + 1) * Mx.text_h;
        xc = Mx.r - xs;
        yc = Mx.t;

        var legendPos = {
            x: xc + 2,
            y: yc + 2,
            width: xs - 5,
            height: ys - 5
        }; // default legend size

        // Determine legend position and label offset based on label sizes
        var defLabelWidth = 98; // a magic number - default width of pixels
        var maxLabelWidth = 0;
        var labelOffset = 0;
        for (n = 0; n < Gx.lyr.length; n++) { // figure out maximum label
            // length
            var labelLength = ctx.measureText(Gx.lyr[n].name).width;
            if (labelLength > maxLabelWidth) {
                maxLabelWidth = labelLength;
            }
        }
        if (maxLabelWidth > defLabelWidth) {
            labelOffset = (maxLabelWidth - defLabelWidth);
            legendPos.width += labelOffset;
            legendPos.x -= labelOffset;
        }

        ctx.strokeStyle = Mx.fg; // Mx.xwfg swapped in for FGColor
        ctx.fillStyle = Mx.bg;
        ctx.fillRect(legendPos.x, legendPos.y, legendPos.width,
            legendPos.height); // Creating a filled box instead of using
        // clear_area
        ctx.strokeRect(legendPos.x, legendPos.y, legendPos.width,
            legendPos.height);

        for (n = 0; n < Gx.lyr.length; n++) {
            ix = xc + 4 * tw;
            iy = yc + n * Mx.text_h + Mx.text_h; // additional text_h to
            // account for 0-based
            // indexing
            if (n === Gx.modlayer) {
                mx.text(Mx, xc + tw - labelOffset, iy + Math.floor(Mx.text_w / 2), '**'); // Added text_w/2
                // offset
            }
            if (Gx.lyr[n].display) {
                ic = Gx.lyr[n].color;
                if (Gx.lyr[n].line > 0) {
                    thk = m.sign(Math.min(tw, Math.abs(Gx.lyr[n].thick)),
                        Gx.lyr[n].thick);
                    // added magic -3 offset to y coordinates to center lines
                    // with text
                    if (thk < 0 || thk === mx.L_dashed) {
                        mx.draw_line(Mx, ic, ix - labelOffset, iy - 3, (ix + tw * 2) - labelOffset, iy - 3, Math.abs(thk), {
                            mode: "dashed",
                            on: 4,
                            off: 4
                        });
                    } else {
                        mx.draw_line(Mx, ic, ix - labelOffset, iy - 3, (ix + tw * 2) - labelOffset, iy - 3, Math.abs(thk));
                    }
                }
                if (Gx.lyr[n].symbol > 0) {
                    // New logic here with 0.6*tw to help with legend symbol
                    // sizing
                    if (Gx.lyr[n].radius < 0) {
                        thk = -m.trunc(0.6 * tw);
                    } else {
                        thk = Math.min(Gx.lyr[n].radius, m.trunc(0.6 * tw));
                    }

                    mx.draw_symbol(Mx, ic, ix + tw - labelOffset, iy - 3,
                        Gx.lyr[n].symbol, thk);
                }
            }
            ix = ix + tw * 3;
            iy = iy + Mx.text_h * 0.3;
            mx.text(Mx, ix - labelOffset, iy, Gx.lyr[n].name);
        }
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function form_plotnote(plot) {
        var Gx = plot._Gx;
        if (Gx.HCB.length === 0) {
            Gx.note = "";
        } else if (Gx.HCB[0].plotnote === undefined) {
            var files = [];
            for (var n = 0; n < Gx.HCB.length; n++) {
                if (Gx.HCB[n].file_name) {
                    files.push(Gx.HCB[n].file_name);
                }
            }
            Gx.note = files.join("|").toUpperCase();
        }
    }

    /**
     * Draws the specified layer.
     *
     * This is expected to be called after clearing the plot.
     *
     * @param {sigplot.Plot}
     *            the plot object
     * @param {Number}
     *            the layer to draw
     * @private
     * @memberOf sigplot
     */
    function draw_layer(plot, n) {
        var Mx = plot._Mx;
        var Gx = plot._Gx;

        if ((n >= Gx.lyr.length) || (!Gx.lyr[n].display) || (Gx.hold !== 0)) {
            return;
        }

        Gx.lyr[n].draw();
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function delete_layer(plot, n) {
        var Gx = plot._Gx;
        //if (n < Gx.modlayer) Gx.modlayer = Gx.modlayer - 1;
        //if (n < Gx.modsource) Gx.modsource = Gx.modsource - 1;
        var topbs;
        if (Gx.lyr[n].display) { topbs = n; }
        Gx.lyr[n].ybufn = 0;
        Gx.lyr[n].ybuf = null;
        if (n < Gx.lyr.length - 1) {
            var lyr = Gx.lyr[n];
            for (var i = n; i < Gx.lyr.length - 1; i++) {
                Gx.lyr[i] = Gx.lyr[i + 1];
            }
        }
        Gx.lyr.length -= 1;

        if (Gx.HCB.length > 0) {
            Gx.panxmin = 1.0;
            Gx.panxmax = -1.0;
            Gx.panymin = 1.0;
            Gx.panymax = -1.0;
        }
        //Gx.yptr = undefined;
        //Gx.xptr = undefined;
        //Gx.pointbufsize = 0;
        //Gx.xptr = undefined; // xpoints ArrayBuffer
        //Gx.yptr = undefined; // ypoints ArrayBuffer
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function draw_crosshairs(plot) {
        var Gx = plot._Gx;
        var Mx = plot._Mx;

        if (Gx.cross) {
            if ((Gx.cross === "vertical") || (Gx.cross === true)) {
                if ((Mx.xpos >= Mx.l) && (Mx.xpos <= Mx.r) && (Gx.cross_xpos !== Mx.xpos)) {
                    if (Gx.cross_xpos !== undefined) {
                        mx.rubberline(Mx, Gx.cross_xpos, Mx.t, Gx.cross_xpos, Mx.b);
                    }
                    mx.rubberline(Mx, Mx.xpos, Mx.t, Mx.xpos, Mx.b);
                    Gx.cross_xpos = Mx.xpos;
                }
            }
            if ((Gx.cross === "horizontal") || (Gx.cross === true)) {
                if ((Mx.ypos >= Mx.t) && (Mx.ypos <= Mx.b) && (Gx.cross_ypos !== Mx.ypos)) {
                    if (Gx.cross_ypos !== undefined) {
                        mx.rubberline(Mx, Mx.l, Gx.cross_ypos, Mx.r, Gx.cross_ypos);
                    }

                    mx.rubberline(Mx, Mx.l, Mx.ypos, Mx.r, Mx.ypos);
                    Gx.cross_ypos = Mx.ypos;
                }
            }
        }
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function changephunits(plot, newphunits) {
        var Gx = plot._Gx;
        var Mx = plot._Mx;
        var newplab = Gx.plab;
        if (newphunits === 'R') {
            newplab = 23;
        } else if (newphunits === 'D') {
            newplab = 24;
        }
        if (newphunits === 'C') {
            newplab = 25;
        }
        if (newplab !== Gx.plab) {
            var phscale = [Math.PI, 180.0, 0.5];
            var dscl = phscale[newplab - 23] / phscale[Gx.plab - 23];
            Gx.plab = newplab;
            if (Gx.cmode === 2) {
                for (var i = 0; i <= Mx.level; i++) {
                    Mx.stk[i].ymin = Mx.stk[i].ymin * dscl;
                    Mx.stk[i].ymax = Mx.stk[i].ymax * dscl;
                    Mx.stk[i].yscl = Mx.stk[i].yscl * dscl;
                }

                Gx.panymin = Gx.panymin * dscl;
                Gx.panymax = Gx.panymax * dscl;
                plot.refresh();
            }
        }
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function changemode(plot, newmode) {
        var Mx = plot._Mx;
        var Gx = plot._Gx;

        Gx.xdata = false;
        for (var n = 0; n < Gx.lyr.length; n++) {
            if (newmode === 5) {
                Gx.lyr[n].xdata = true;
            } else {
                Gx.lyr[n].xdata = false; // TODO (Gx.lyr(n).xsub > 0)
            }
            if (Gx.lyr[n].xdata) {
                Gx.xdata = true;
	    }
        }

        if (newmode === Gx.cmode) {
            return;
        } else if (newmode === 5 && Gx.index) {
            alert("Imag/Real mode not permitted in INDEX mode");
        } else if (Gx.lyr.length <= 0) {
            Gx.cmode = newmode;
            // The call to display specs isn't found in sigplot.for;
            // which causes a small bug where the plot mode is
            // changed but the mode label in the specs area
            // isn't updated.
            display_specs(plot);
        } else if (newmode > 0) {
            var oldmode = Gx.cmode;
            Gx.cmode = newmode;

            var autox = Gx.autox;
            var autoy = Gx.autoy;
            Gx.autox = 3;
            Gx.autoy = 3;

            if ((newmode === 5) || (oldmode === 5)) {
                Gx.panxmin = 1.0;
                Gx.panxmax = -1.0;
                Gx.panymin = 1.0;
                Gx.panymax = -1.0;
                Mx.level = 0;

                if (newmode === Gx.basemode) {
                    Mx.stk[0].xmin = Gx.xmin;
                    Mx.stk[0].xmax = Gx.xmax;
                    Mx.stk[0].ymin = Gx.ymin;
                    Mx.stk[0].ymax = Gx.ymax;
                } else if ((newmode === 5) || (Gx.basemode === 5)) {
                    scale_base(plot, {
                        get_data: true
                    });
                } else {
                    Mx.stk[0].xmin = Gx.xmin;
                    Mx.stk[0].xmax = Gx.xmax;
                    scale_base(plot, {
                        get_data: true
                    }, Gx.xmin, Gx.xmax);
                }
            } else {
                if (newmode === Gx.basemode) { // This is only correct if we
                    // didn't load a basefile
                    Gx.panymin = 1.0;
                    Gx.panymax = -1.0;
                    Mx.stk[0].ymin = Gx.ymin;
                    Mx.stk[0].ymax = Gx.ymax;
                } else {
                    scale_base(plot, {}, Mx.stk[Mx.level].xmin,
                        Mx.stk[Mx.level].xmax);
                }
                for (var n = 1; n <= Mx.level; n++) {
                    Mx.stk[n].ymin = Mx.stk[0].ymin;
                    Mx.stk[n].ymax = Mx.stk[0].ymax;
                }
            }
            Gx.autox = autox;
            Gx.autoy = autoy;
            plot.refresh();
        }
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function draw_panbars(plot) {
        var k; // integer*4
        //var i1; // integer*4
        //var itext; // integer*4

        var Mx = plot._Mx;
        var Gx = plot._Gx;

        if ((!Gx.pan) || (Mx.widget)) {
            return;
	}

        k = Mx.level; // Y scrollbar

        var out = {
            ps: Mx.stk[k].ymin,
            pe: Mx.stk[k].ymax
        };
        var need_y_scrollbar = ((out.ps !== Gx.panymin) || (out.pe !== Gx.panymax));
        need_y_scrollbar = need_y_scrollbar && (Mx.level > 0);

        if (Gx.autohide_panbars && (!need_y_scrollbar || !plot.mouseOnCanvas) && !Gx.panning) {
            var ctx = Mx.canvas.getContext("2d");
            ctx.fillStyle = Mx.bg;
            ctx.fillRect(Gx.pyl, Mx.t, Gx.pyl + Gx.pthk, Mx.b - Mx.t);
        } else {
            var i1 = mx.scrollbar(Mx, 0, Gx.pyl, Gx.pyl + Gx.pthk, Mx.t, Mx.b, out,
                Gx.panymin, Gx.panymax, undefined, Mx.scrollbar_y);
            Mx.stk[k].ymin = out.ps;
            Mx.stk[k].ymax = out.pe;
        }

        if (Gx.pl < Mx.width) { // X scrollbar
            out = {
                ps: Mx.stk[k].xmin,
                pe: Mx.stk[k].xmax
            };
            var need_x_scrollbar = ((out.ps !== Gx.panxmin) || (out.pe !== Gx.panxmax));
            need_x_scrollbar = need_x_scrollbar && (!Gx.all || (Mx.level > 0));

            if (Gx.autohide_panbars && (!need_x_scrollbar || !plot.mouseOnCanvas) && !Gx.panning) {
                var ctx = Mx.canvas.getContext("2d");
                ctx.fillStyle = Mx.bg;
                ctx.fillRect(Gx.pl, Gx.pt - 1, Gx.pr - Gx.pl, Gx.pthk + 4);
            } else {
                var i1 = mx.scrollbar(Mx, 0, Gx.pl, Gx.pr, Gx.pt, Gx.pt + Gx.pthk, out,
                    Gx.panxmin, Gx.panxmax, undefined, Mx.scrollbar_x);
                Mx.stk[k].xmin = out.ps;
                Mx.stk[k].xmax = out.pe;
            }
        }
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function pan(plot, action, flag, mouseEvent) {
        var Mx = plot._Mx;
        var Gx = plot._Gx;

        var i; // an integer*4
        var k; // an integer*4
        // var ih // an integer*4
        // var iw; // an integer*4
        // var imin; // an integer*4
        // var imax; // an integer*4
        var j; // an integer*4
        var xmin; // a real*8
        var xmax; // a real*8
        var xran; // a real*8
        // var xtemp; // a real*8
        var ymin; // a real*8
        var ymax; // a real*8
        var yran; // a real*8
        // var ytemp; // a real*8
        var warn; // a logical*4

        var scrollbarState;

        var sbx = new mx.SCROLLBAR(); // a SCROLLBAR
        var sby = new mx.SCROLLBAR(); // a SCROLLBAR

        var SIGPLOT_PAN = false;
        k = Mx.level;
        if (Gx.panmode > 0) {
            sbx.flag = 11;
            sby.flag = 11;
        } else {
            sbx.flag = -12;
            sby.flag = -12;
        }
        if (flag === 0) {
            sbx.action = 0;
            sby.action = 0;
        }

        warn = true;
        if (action.substring(0, 1) === 'Y') {
            ymin = Mx.stk[k].ymin;
            ymax = Mx.stk[k].ymax;
            yran = ymax - ymin;
            if (action === 'YPAN') {
                scrollbarState = Mx.scrollbar_y;

                var out = {
                    ps: ymin,
                    pe: ymax
                };
                i = mx
                    .scrollbar(Mx, sby, Gx.pyl, Gx.pyl + Gx.pthk, Mx.t,
                        Mx.b, out, Gx.panymin, Gx.panymax, mouseEvent,
                        scrollbarState);
                ymin = out.ps;
                ymax = out.pe;
                // TODO: Warn only if Scrollbar arrow is pressed and no
                // movement.
                if (sby.action !== 0) {
                    j = mx.scroll(Mx, sby, mx.XW_UPDATE, undefined,
                        scrollbarState);
                }
                warn = false;
            } else if (action === 'YCENTER') {
                // Orig code : ymin = ymin - yran * (Mx.ypos - (Mx.t + Mx.b) /
                // 2) / (Mx.b - Mx.t) // TODO Worry about any int division here?
                ymin = ymin - yran * (Mx.ypos - (Mx.t + Mx.b) / 2) / (Mx.b - Mx.t);
                ymax = ymin + yran;
                warn = false;
            }

            if (ymin !== Mx.stk[k].ymin || ymax !== Mx.stk[k].ymax) {
                Mx.stk[k].ymin = ymin;
                Mx.stk[k].ymax = ymax;
                if (Gx.cmode === Gx.basemode && Mx.level === 1) {
                    Gx.ymin = Math.min(Gx.ymin, ymin);
                    Gx.ymax = Math.max(Gx.ymax, ymax);
                }
                plot.refresh();
                // MSGDO(MSK_PANY, Mx.level); // just sets plotinfo.xmin and
                // xmax into the MQD for the menu
                SIGPLOT_PAN = true;
            }
            // TODO Later - Implement a messagebox status method
            // else if (warn) {
            // mx.message('All panned out', -1.0);
            // }
        } else {
            xmin = Mx.stk[k].xmin;
            xmax = Mx.stk[k].xmax;
            xran = xmax - xmin;
            if (action === 'XPAN') {
                scrollbarState = Mx.scrollbar_x;

                var out = {
                    ps: xmin,
                    pe: xmax
                };
                i = mx
                    .scrollbar(Mx, sbx, Gx.pl, Gx.pr, Gx.pt, Gx.pt + Gx.pthk, out, Gx.panxmin, Gx.panxmax,
                        mouseEvent, scrollbarState);
                xmin = out.ps;
                xmax = out.pe;
                // TODO: Warn only if Scrollbox arrow is pressed and no
                // movement.
                if (sbx.action !== 0) {
                    j = mx.scroll(Mx, sbx, mx.XW_UPDATE, undefined,
                        scrollbarState);
                }
                warn = false;
            } else if (action === 'XCENTER') {
                // Original code : xmin = xmin + xran * (Mx.xpos - (Mx.l + Gx.r)
                // / 2) / (Mx.r - Mx.l) // TODO Worry about any int division
                // here?
                xmin = xmin + xran * (Mx.xpos - (Mx.l + Mx.r) / 2) / (Mx.r - Mx.l);
                if (xmin !== Mx.stk[k].xmin) {
                    xmax = xmin + xran;
		}
                warn = false;
            }

            if (Mx.stk[k].xmin !== xmin || Mx.stk[k].xmax !== xmax) {
                Mx.stk[k].xmin = xmin;
                Mx.stk[k].xmax = xmax;
                if (!Gx.xdata && Mx.level === 1) {
                    Gx.xmin = Mx.stk[1].xmin;
                    Gx.xmax = Mx.stk[1].xmax;
                }
                plot.refresh();
                // MSGDO (MSK_PANX, Mx.level); // just sets plotinfo.xmin and
                // xmax into the MQD for the menu
                SIGPLOT_PAN = true;
            }
            // TODO Later - Implement a messagebox status method
            // else if (warn) {
            // mx.message('All panned out', -1.0);
            // }
        }

        return SIGPLOT_PAN;
    }

    /**
     * Direct method to handle the dragging of a scrollbar.
     *
     * @param plot
     *            The plot to work with.
     * @param scrollAction
     *            The scroll action being performed. Either "YPAN" or "XPAN" are
     *            accepted.
     * @param event
     *            The mouse move event.
     * @private
     * @memberOf sigplot
     */
    function drag_scrollbar(plot, scrollAction, event) {
        var Mx = plot._Mx;
        var Gx = plot._Gx;
        var min;
        var max;

        // ----- Retrieve appropriate SCROLLBAR -----
        var scrollbar;
        if (scrollAction === "XPAN") {
            scrollbar = plot._Mx.scrollbar_x;
        } else if (scrollAction === "YPAN") {
            scrollbar = plot._Mx.scrollbar_y;
        } else {
            throw "Unable to drag scrollbar - scrollAction is not 'XPAN' or 'YPAN'!!";
        }

        // ----- OLD SIGPLOT.PAN Logic -----
        scrollbar.flag = -12; // TODO Necessary?
        var k = Mx.level;
        if (scrollAction === "XPAN") {
            min = Mx.stk[k].xmin;
            max = Mx.stk[k].xmax;
        } else if (scrollAction === "YPAN") {
            min = Mx.stk[k].ymin;
            max = Mx.stk[k].ymax;
        } else {
            min = undefined;
            max = undefined;
        }

        // ----- MX.SCROLLBAR Logic -----
        var rangeOut = {
            "min": min,
            "max": max
        };
        drag_updateRange(Mx, Gx, scrollbar, scrollAction, rangeOut, event);
        min = rangeOut.min;
        max = rangeOut.max;

        // ----- UPDATE SCROLLBAR -----
        scrollbar.smin = min;
        scrollbar.srange = max - min;
        mx.redrawScrollbar(scrollbar, Mx, undefined);

        // ----- Update the viewbox -----
        updateViewbox(plot, scrollbar.smin, scrollbar.smin + scrollbar.srange,
            scrollAction.slice(0, 1));

        scrollbar.action = 0; // TODO New step - reset action of the scrollbar
        // after drag is done...
        plot.refresh();
    }

    /**
     * Method to update plot range based on a drag event. Takes the mouse offset
     * introduced by the drag and adds a scale factor.
     *
     * @param Gx
     *            The GX Context to work with.
     * @param scrollbar
     *            The Scrollbar to use.
     * @param scrollAction
     *            The scroll action being performed. Either "YPAN" or "XPAN" are
     *            accepted.
     * @param range
     *            The plot' min and max range values to update.
     * @param event
     *            The mouse move event.
     *
     * @private
     * @memberOf sigplot
     */
    function drag_updateRange(Mx, Gx, scrollbar, scrollAction, range, event) {
        scrollbar.action = mx.SB_DRAG;

        if (scrollAction === "YPAN") {
            var scaleFactor = Mx.scrollbar_y.trange / Mx.scrollbar_y.h;
            if (scrollbar.origin === 4) { // inverted y
                scaleFactor *= -1;
            }
            var mouseOffset = event.screenY - Gx.panning.ypos;
            var realOffset = mouseOffset * scaleFactor;

            if ((Gx.panning.ymin - realOffset) < Gx.panymin) { // At the left
                // edge
                range.max = Gx.panymin + (range.max - range.min);
                range.min = Gx.panymin;
            } else if ((Gx.panning.ymax - realOffset) > Gx.panymax) { // At
                // the
                // right
                // edge
                range.min = Gx.panymax - (range.max - range.min);
                range.max = Gx.panymax;
            } else {
                range.min = Gx.panning.ymin - realOffset;
                range.max = Gx.panning.ymax - realOffset;
            }
        } else if (scrollAction === "XPAN") {
            var scaleFactor = Mx.scrollbar_x.trange / Mx.scrollbar_x.w;
            if (scrollbar.origin === 3) { // inverted x
                scaleFactor *= -1;
            }
            var mouseOffset = event.screenX - Gx.panning.xpos;
            var realOffset = mouseOffset * scaleFactor;

            if ((Gx.panning.xmin + realOffset) < Gx.panxmin) { // At the left
                // edge
                range.max = Gx.panxmin + (range.max - range.min);
                range.min = Gx.panxmin;
            } else if ((Gx.panning.xmax + realOffset) > Gx.panxmax) { // At
                // the
                // right
                // edge
                range.min = Gx.panxmax - (range.max - range.min);
                range.max = Gx.panxmax;
            } else {
                range.min = Gx.panning.xmin + realOffset;
                range.max = Gx.panning.xmax + realOffset;
            }
        }
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function setupPrompt(plot, promptText, isValid, onSuccess, inputValue,
        xpos, ypos, callback) {
        var Mx = plot._Mx;

        if (Mx.prompt) {
            throw "Prompt already exists! Can only have one prompt at a time!";
        }

        // Disable Mx keypress/mouse listeners
        mx.disableListeners(Mx);

        // Disable Plot keypress/mouse listeners
        plot.disable_listeners();

        // Add on to the onSuccess method with plot specifics
        var realOnSuccess = function(plot, onSuccess) {
            return function(value) {
                onSuccess(value);

                // Re-enable Mx keypress/mouse listeners
                mx.enableListeners(Mx);

                // Re-enable Plot keypress/mouse listeners
                plot.enable_listeners();

                plot.refresh();

                if (callback !== undefined) {
                    callback();
                }
            };
        };

        var refresh = function() { // TODO Refactor this setup method to be
            // more like mx.menu/main menu widget?
            plot.refresh();
        };

        // Create the prompt
        var errorMessageTimeout = 5000;

        try {
            mx.prompt(Mx, promptText, isValid, realOnSuccess(plot, onSuccess),
                refresh, inputValue, xpos, ypos, errorMessageTimeout);
        } catch (err) {
            console.log("ERROR: Failed to set up prompt due to: " + err);
        }
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function enable_listeners(plot) {
        var Mx = plot._Mx;
        mx.addEventListener(Mx, "mousedown", plot.onmousedown, false);
        mx.addEventListener(Mx, "mousemove", plot.throttledOnMouseMove, false);
        document.addEventListener("mouseup", plot.docMouseUp, false);
        mx.addEventListener(Mx, "mouseup", plot.mouseup, false);
        window.addEventListener("mousedown", plot.dragMouseDownHandler, false);
        window.addEventListener("mousemove", plot.throttledDragOnMouseMove, false);
        window.addEventListener("mouseup", plot.dragMouseUpHandler, false);
        window.addEventListener("wheel", plot.wheelHandler, false);
        window.addEventListener("mousewheel", plot.wheelHandler, false);
        window.addEventListener("DOMMouseScroll", plot.wheelHandler, false);
        window.addEventListener("keypress", plot.onkeypress, false);
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function disable_listeners(plot) {
        var Mx = plot._Mx;

        mx.removeEventListener(Mx, "mousedown", plot.onmousedown, false);
        mx.removeEventListener(Mx, "mousemove", plot.throttledOnMouseMove,
            false);
        document.removeEventListener("mouseup", plot.docMouseUp, false);
        mx.removeEventListener(Mx, "mouseup", plot.mouseup, false);
        window.removeEventListener("mousedown", plot.dragMouseDownHandler,
            false);
        window.removeEventListener("mousemove", plot.throttledDragOnMouseMove,
            false);
        window.removeEventListener("mouseup", plot.dragMouseUpHandler, false);
        window.removeEventListener("wheel", plot.wheelHandler, false);
        window.removeEventListener("mousewheel", plot.wheelHandler, false);
        window.removeEventListener("DOMMouseScroll", plot.wheelHandler, false);
        window.removeEventListener("keypress", plot.onkeypress, false);
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function display_specs(plot) {
        var Mx = plot._Mx;
        var Gx = plot._Gx;

        var ctx = Mx.canvas.getContext("2d");

        // section logic
        if (Gx.sections !== 0) {
            // TODO
        } else {
            Gx.isec = 0;
        }

        // transform into realworld coordinates
        // is already done by the mousemove listener
        // adjust for abscissa mode
        Gx.aretx = Gx.retx;
        Gx.arety = Gx.rety;
        Gx.dretx = Gx.retx - Gx.xmrk;
        Gx.drety = Gx.rety - Gx.ymrk;

        if ((Gx.cmode === 5) && (Gx.iabsc === 1)) {
            Gx.iabsc = 2;
        } // R/I mode
        if (Gx.iabsc === 1) { // index
            Gx.aretx = Math.round((Gx.aretx - Gx.xstart) / Gx.xdelta);
            if (!Gx.index) {
                Gx.aretx += 1;
            }
            Gx.dretx = Math.round(Gx.dretx / Gx.xdelta);
        } else if (Gx.iabsc === 2) { // 1/absc
            if (Gx.aretx !== 0.0) {
                Gx.aretx = 1.0 / Gx.aretx;
	    }
            if (Gx.arety !== 0.0) {
                Gx.arety = 1.0 / Gx.arety;
	    }
            if (Gx.dretx !== 0.0) {
                Gx.dretx = 1.0 / Gx.dretx;
	    }
            if (Gx.drety !== 0.0) {
                Gx.drety = 1.0 / Gx.drety;
	    }
        }

        if ((!Gx.show_readout) || (Mx.widget)) {
            return;
        }

        // Clear the specs area
        ctx.fillStyle = Mx.bg;
        var iy = Math.floor(Mx.height - 2.5 * Mx.text_h);
        ctx.fillRect(Mx.text_w, iy, 49 * Mx.text_w, iy + 1.5 * Mx.text_h);

        iy = Math.floor(Mx.height - 0.5 * Mx.text_h);
        var k = Math.max(Gx.pr + Mx.text_w, Mx.width - Mx.text_w * 2);
        ctx.fillStyle = Mx.bg;
        ctx.fillRect(k, iy - Mx.text_h, Mx.text_w, Mx.text_h);

        if (Gx.autohide_readout && !plot.mouseOnCanvas && !Gx.panning) {
            return;
        }

        var chara = "y: " + mx.format_g(Gx.arety, 16, 9, true) + " dy: " + mx.format_g(Gx.drety, 16, 9) + " L=" + Mx.level + " " + cxm[Gx.cmode - 1];
        var charb = "x: " + mx.format_g(Gx.aretx, 16, 9, true) + " dx: " + mx.format_g(Gx.dretx, 16, 9) + " " + cam[Gx.iabsc];
        if (Gx.iabsc === 3) {
            if (Gx.dretx === 0.0) {
                chara = chara.substr(0, 20) + "sl: Inf             " + chara.substr(40, chara.length);
            } else {
                chara = chara.substr(0, 20) + "sl: " + mx.format_g(Gx.drety / Gx.dretx, 16, 9) + chara.substr(40, chara.length);
            }
        }

        iy = Math.floor(Mx.height - 1.5 * Mx.text_h);
        mx.text(Mx, Mx.text_w, iy, chara);
        iy = Math.floor(Mx.height - 0.5 * Mx.text_h);
        mx.text(Mx, Mx.text_w, iy, charb);

        // display controls indicator
        if (k < Mx.width) {
            if (Gx.cntrls > 0) {
                mx.text(Mx, k, iy, 'C');
            } else {
                mx.text(Mx, k, iy, ' ');
            }
        }

        // draw color bar
        var x = (49 * Mx.text_w) - 1;
        var y = Mx.height - Mx.text_h * 2.5;
        var w = Mx.text_w;
        var h = Mx.text_h * 2;

        mx.colorbar(Mx, x, y, w, h);
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function scale_base(plot, mode, xxmin, xxmax, xlab, ylab) {
        var Mx = plot._Mx;
        var Gx = plot._Gx;

        var load = (mode.get_data === true);

        Gx.panxmin = 1.0;
        Gx.panxmax = -1.0;
        Gx.panymin = 1.0;
        Gx.panymax = -1.0;
        var xmin = xxmin;
        var xmax = xxmax;
        var noxmin = (xmin === undefined);
        var noxmax = (xmax === undefined);
        if (Gx.lyr.length === 0) {
            Gx.panxmin = -1.0;
            Gx.panxmax = 1.0;
            Gx.panymin = -1.0;
            Gx.panymax = 1.0;
        } else {
            if (xlab === undefined) {
                Gx.xlab = Gx.lyr[0].xlab;
            }
            if (ylab === undefined) {
                Gx.ylab = Gx.lyr[0].ylab;
            }

            for (var n = 0; n < Gx.lyr.length; n++) {
                if (noxmin) {
                    xmin = Gx.lyr[n].xmin;
                }

                if (noxmax) {
                    xmax = Gx.lyr[n].xmax;
                }

                if (Gx.xlab !== Gx.lyr[n].xlab) {
                    Gx.xlab = 0; // If the layers aren't consistent use None
                }
                if (Gx.ylab !== Gx.lyr[n].ylab) {
                    Gx.ylab = 0; // If the layers aren't consistent use None
                }

                if (load) {
                    Gx.lyr[n].get_data(xmin, xmax);
                }

                if (Gx.autox > 0 || Gx.autoy > 0) {
                    while (xmin < xmax) {
                        // get_data fills in the layer xbuf/ybuf with data
                        Gx.lyr[n].get_data(xmin, xmax);

                        // sigplot_prep fills in Gx.xptr and Gx.yptr (both PointArray)
                        // with the data to be plotted
                        var npts = Gx.lyr[n].prep(xmin, xmax);

                        // If both All and Expand are provided we
                        // need to look at the entire file to auto-scale it
                        if (Gx.all && Gx.expand) {
                            if (Gx.lyr[n].size === 0) {
                                xmin = xmax;
                            } else {
                                if (Gx.index) {
                                    xmin = xmin + npts;
                                } else {
                                    if (Gx.lyr[n].xdelta >= 0) {
                                        xmin = xmin + (Gx.lyr[n].size * Gx.lyr[n].xdelta);
                                    } else {
                                        xmax = xmax + (Gx.lyr[n].size * Gx.lyr[n].xdelta);
                                    }
                                }
                            }
                        } else {
                            xmin = xmax;
                        }
                    }
                } else {
                    Gx.lyr[n].prep(1.0, -1.0);
                }
            }
        }

        var xran = Gx.panxmax - Gx.panxmin;
        if (xran < 0.0) {
            Gx.panxmax = Gx.panxmin;
            Gx.panxmin = Gx.panxmax + xran;
            xran = -xran;
        }
        if (xran <= 1.0e-20) {
            Gx.panxmin = Gx.panxmin - 1.0;
            Gx.panxmax = Gx.panxmax + 1.0;
        }

        if (((Gx.autox & 1) !== 0) && noxmin) {
            Mx.stk[0].xmin = Gx.panxmin;
        }
        if (((Gx.autox & 2) !== 0) && noxmax) {
            Mx.stk[0].xmax = Gx.panxmax;
            if (!(Gx.all || Gx.xdata)) {
                for (var n = 0; n < Gx.lyr.length; n++) {
                    xmax = Math.min(Gx.lyr[n].xmax, Mx.stk[0].xmax);
                    var dpts = Math.abs((xmax - Gx.lyr[n].xmin) / Gx.lyr[n].xdelta) - Gx.bufmax + 1.0;
                    if (dpts > 0) {
                        Mx.stk[0].xmax = xmax - dpts * Math.abs(Gx.lyr[n].xdelta);
                    }
                }
            }
        }

        if (((Gx.autoy & 1) !== 0)) {
            Mx.stk[0].ymin = Gx.panymin;
        }
        if (((Gx.autoy & 2) !== 0)) {
            Mx.stk[0].ymax = Gx.panymax;
        }
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function pixel_to_real(plot, xpos, ypos) {
        var Gx = plot._Gx;
        var Mx = plot._Mx;

        var ret = mx.pixel_to_real(Mx, xpos, ypos);
        if (Gx.index) {
            ret.x = ret.x * Gx.xdelta;
        }

        return ret;
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function coordsInRectangle(x, y, rect_x, rect_y, rect_width, rect_height) {
        return (x >= rect_x && x <= rect_x + rect_width && y >= rect_y && y <= rect_y + rect_height);
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function inPanRegion(plot) {
        var inPanRegion = false;
        var Gx = plot._Gx;
        var Mx = plot._Mx;
        var x = Mx.xpos;
        var y = Mx.ypos;

        var command = ' ';

        if (!plot.mouseOnCanvas) {
            return false;
        }

        if (Gx.pan && (x > Mx.r && y >= Mx.t && y <= Mx.b)) { // YPAN
            command = 'YPAN'; // Y scrollbar
            Mx.xpos = Gx.pyl + m.trunc(Gx.pthk / 2); // TODO do we want to
            // reset the xposition?

            inPanRegion = true;
        } else if (Gx.pan && (x >= Gx.pl && x <= Gx.pr) && ((Gx.show_readout && y > Gx.pt - 2) || (!Gx.show_readout && y <= Gx.pt + Gx.pthk + 2))) { // XPAN
            command = 'XPAN'; // X scrollbar
            Mx.ypos = Gx.pt + m.trunc(Gx.pthk / 2); // TODO Do we want to reset
            // the yposition?

            inPanRegion = true;
        }

        return {
            inPanRegion: inPanRegion,
            command: command
        };
    }

    /**
     * @memberOf sigplot
     * @private
     */
    function inPanCenterRegion(plot) {
        var inCenterRegion = false;
        var Mx = plot._Mx;
        var x = Mx.xpos;
        var y = Mx.ypos;
        var th = Mx.text_h;
        var tw = Mx.text_w;
        var command = ' ';

        if (x < Mx.l - tw && y <= Mx.b && y >= Mx.t) { // YCENTER
            // Mx.canvas.getContext("2d").strokeStyle = "blue";
            // Mx.canvas.getContext("2d").strokeRect(0, Mx.t, Mx.l - tw, Mx.b -
            // Mx.t);
            command = 'YCENTER';
            inCenterRegion = true;
        } else if (y > Mx.b + m.trunc(0.5 * tw) && y <= Mx.b + m.trunc(m.trunc(3 * th) / 2) && x >= Mx.l && x <= Mx.r) { // XCENTER
            // Mx.canvas.getContext("2d").strokeStyle = "red";
            // Mx.canvas.getContext("2d").strokeRect(Mx.l, Mx.b + m.trunc(.5 *
            // tw),
            // Mx.r - Mx.l, (Mx.b + m.trunc(m.trunc(3 * th) / 2)) - (Mx.b +
            // m.trunc(.5 * tw)));
            command = 'XCENTER';
            inCenterRegion = true;
        }

        return {
            inCenterRegion: inCenterRegion,
            command: command
        };
    }

    /**
     * Returns true if position is within the given scrollbar's area. Depends on
     * mx.scroll_real2pix method.
     *
     * @param position
     *            An object containing 'x' and 'y' pixel values that represent a
     *            position.
     * @param scrollbar
     *            The scrollbar object itself.
     *
     * @private
     * @memberOf sigplot
     */
    function onScrollbar(position, scrollbar) {
        var s1;
        var sw;

        /*
         * Compute s, the offset in pixels from the 'origin' of the scrollbar's
         * on-screen region.
         */
        var s;
        if (scrollbar.origin & 1) {
            s = position.x - scrollbar.x;
            if (scrollbar.origin & 2) {
                s = scrollbar.w - s;
	    }
        } else {
            s = position.y - scrollbar.y;
            if (scrollbar.origin <= 2) {
                s = scrollbar.h - s;
	    }
        }

        // Update s1 and sw values
        var scrollReal2PixOut = mx.scroll_real2pix(scrollbar);
        s1 = scrollReal2PixOut.s1;
        sw = scrollReal2PixOut.sw;

        // Determine if mouse is on scrollbar
        if (s >= s1 && s <= s1 + sw) {
            return true;
        } else {
            return false;
        }
    }

    /**
     * Performs the middle-click scroll-menu action specified on the plot.
     *
     * @param plot
     *            The plot to work with.
     * @param action
     *            The scrollbar action to perform.
     * @param direction
     *            The scroll direction to update. Acceptable directions are
     *            either "XPAN" or "YPAN".
     * @memberOf sigplot
     * @private
     */
    function middleClickScrollMenuAction(plot, action, direction) {
        var Mx = plot._Mx;

        // Determine the appropriate scrollbar to work with
        var scrollbar;
        if (direction === "XPAN") {
            scrollbar = Mx.scrollbar_x;
        } else if (direction === "YPAN") {
            scrollbar = Mx.scrollbar_y;
        }

        // Set scrollbar action
        scrollbar.action = action;
        scrollbar.step = 0.1 * scrollbar.srange;
        scrollbar.page = 9 * scrollbar.step;
        scrollbar.scale = 2.0;

        // Update min and range to the appropriate values based on action
        mx.scroll(Mx, scrollbar, mx.XW_COMMAND, undefined, scrollbar);

        // Update the viewbox based on new min and max values
        updateViewbox(plot, scrollbar.smin, scrollbar.smin + scrollbar.srange,
            direction.slice(0, 1));
    }

    /**
     * Updates a plot's viewbox along a given axis to the provided min and max
     * values.
     *
     * @param plot
     *            The plot to work with.
     * @param newMin
     *            The new minimum axis value to use
     * @param newMax
     *            The new maximum axis value to use
     * @param axis
     *            The axis to update. Acceptable axis values are "X" or "Y".
     * @memberOf sigplot
     * @private
     */
    function updateViewbox(plot, newMin, newMax, axis) {
        var Mx = plot._Mx;
        var Gx = plot._Gx;

        var k = Mx.level;

        if (axis === "X") {
            var xmin = newMin;
            var xmax = newMax;

            if (Mx.stk[k].xmin !== xmin || Mx.stk[k].xmax !== xmax) {
                Mx.stk[k].xmin = xmin;
                Mx.stk[k].xmax = xmax;
                if (!Gx.xdata && Mx.level === 1) {
                    Gx.xmin = Mx.stk[1].xmin;
                    Gx.xmax = Mx.stk[1].xmax;
                }
                plot.refresh();
            }
        } else if (axis === "Y") {
            var ymin = newMin;
            var ymax = newMax;

            if (ymin !== Mx.stk[k].ymin || ymax !== Mx.stk[k].ymax) {
                Mx.stk[k].ymin = ymin;
                Mx.stk[k].ymax = ymax;
                if (Gx.cmode === Gx.basemode && Mx.level === 1) {
                    Gx.ymin = Math.min(Gx.ymin, ymin);
                    Gx.ymax = Math.max(Gx.ymax, ymax);
                }
                plot.refresh();
            }
        }
    }

}(window.sigplot, window.mx, window.m));
