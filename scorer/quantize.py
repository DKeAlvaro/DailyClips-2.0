#!/usr/bin/env python3
"""Builds the model the Pro scorer runs: facebook/wav2vec2-lv-60-espeak-cv-ft with only its MatMul
weights quantised to int8.

    python scorer/quantize.py model.onnx lv60_mm8.onnx     # needs onnx + onnxruntime; model.onnx is the float
                                                           # export (onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX)

Measured on the server (1 vCPU, 3.5 s of audio): float 1.26 GB on disk, 1.7 GB of RAM, 1.95 s;
the ready-made int8 export 318 MB, 0.45 GB, 2.6 s (its convolutions become ConvInteger, which ONNX
Runtime runs several times slower than a float Conv); this one 355 MB, 0.47 GB, 0.95 s.
"""
import sys, time
from onnxruntime.quantization import QuantType, quantize_dynamic
src, dst = sys.argv[1], sys.argv[2]
t = time.time()
quantize_dynamic(src, dst, op_types_to_quantize=["MatMul"], weight_type=QuantType.QInt8, per_channel=False, extra_options={"MatMulConstBOnly": True})
print("done in %.0fs" % (time.time() - t))
