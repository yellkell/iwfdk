/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Depth preprocessing shader — ported from Meta SDK DepthPreprocessing.shader.
 *
 * A single fullscreen pass on the raw XR depth texture that computes
 * min/max/avg depth in a 4×4 neighborhood, written to an RGBA float target.
 *
 * Output: vec4(minAvg, maxAvg, avg - minAvg, maxAvg - minAvg) in meters.
 * The interpolation ratio (avg-minAvg)/(maxAvg-minAvg) is deferred to the
 * occlusion shader to preserve bilinear interpolation properties.
 */
export const DepthPreprocessingShader = {
  name: 'DepthPreprocessingShader',

  vertexShader: /* glsl */ `
varying vec2 vUv;

void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,

  fragmentShader: /* glsl */ `
precision highp float;

uniform sampler2DArray uXRDepthTextureArray;
uniform float uRawValueToMeters;
uniform int uViewId;
uniform vec2 uDepthTextureSize;
uniform bool uIsGPUDepth;
uniform float uDepthNear;

varying vec2 vUv;

float depthToMeters(float textureValue) {
	if (uIsGPUDepth) {
		return uRawValueToMeters * uDepthNear / (1.0 - textureValue);
	}
	return textureValue * uRawValueToMeters;
}

void main() {
	vec2 texelSize = 1.0 / uDepthTextureSize;
	vec2 baseUV = vUv - texelSize * 1.5;

	// Single pass: sample 4×4 neighborhood, convert, and store in 4 vec4s
	vec4 depths[4];
	float rawMin = 1e20;
	float rawMax = 0.0;
	float sum = 0.0;
	int count = 0;

	for (int row = 0; row < 4; row++) {
		for (int col = 0; col < 4; col++) {
			vec2 sampleUV = baseUV + vec2(float(col), float(row)) * texelSize;
			float rawValue = texture(uXRDepthTextureArray, vec3(sampleUV, float(uViewId))).r;
			float meters = depthToMeters(rawValue);
			depths[row][col] = meters;

			if (meters > 0.0) {
				rawMin = min(rawMin, meters);
				rawMax = max(rawMax, meters);
				sum += meters;
				count++;
			}
		}
	}

	if (count == 0) {
		gl_FragColor = vec4(0.0);
		return;
	}

	float avg = sum / float(count);

	// Group samples near the min (within 115%) and near the max (within 85%)
	// to compute stable minAvg and maxAvg — ported from CalculateMinMaxDepth
	float minThreshold = rawMin * 1.15;
	float maxThreshold = rawMax * 0.85;

	// Degenerate case: neighborhood is uniform (within both thresholds)
	if (maxThreshold < rawMin && minThreshold > rawMax) {
		gl_FragColor = vec4(avg, avg, 0.0, 0.0);
		return;
	}

	// Vectorized clustering using stored depths — no second sampling loop
	float minSumDepth = 0.0;
	float minSumCount = 0.0;
	float maxSumDepth = 0.0;
	float maxSumCount = 0.0;

	for (int i = 0; i < 4; i++) {
		vec4 valid = vec4(greaterThan(depths[i], vec4(0.0)));
		vec4 minMask = vec4(lessThanEqual(depths[i], vec4(minThreshold))) * valid;
		vec4 maxMask = vec4(greaterThanEqual(depths[i], vec4(maxThreshold))) * valid;
		minSumDepth += dot(minMask, depths[i]);
		minSumCount += dot(minMask, vec4(1.0));
		maxSumDepth += dot(maxMask, depths[i]);
		maxSumCount += dot(maxMask, vec4(1.0));
	}

	float minAvg = minSumCount > 0.0 ? minSumDepth / minSumCount : rawMin;
	float maxAvg = maxSumCount > 0.0 ? maxSumDepth / maxSumCount : rawMax;

	gl_FragColor = vec4(minAvg, maxAvg, avg - minAvg, maxAvg - minAvg);
}
`,
};
