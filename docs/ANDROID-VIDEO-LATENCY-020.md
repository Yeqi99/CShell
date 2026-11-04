# Android video latency follow-up — 0.8.20 candidate

The Android host previously dropped every capture frame arriving before the previous viewer ACK and marked the H264 dependency chain invalid. With a 30 fps encoder and RTT above one frame interval, this repeatedly forced keyframe recovery; the capture-side keyframe request throttle could make otherwise healthy links visibly stall.

The host now retains at most three contiguous encoded frames, 32 MiB total, for at most 120 ms of queue residence. ACK immediately drains the next frame. Overflow or expiration discards the broken dependency chain and requires a new keyframe; a keyframe replaces obsolete queued output. Quality changes, explicit keyframe requests and close clear the queue. The existing one-frame-in-flight protocol, authentication and input authorization remain unchanged.

Validation: Java queue tests passed for 20/60/150 ms ACK simulations (3 seconds: 91/46/19 deliveries; at 60 ms, 34 delta frames retained). Tests cover missing keyframes, expiration and configuration reset. Both production and Android instrumentation Java compilation passed locally. The real TLS host test now exercises delayed ACKs with consecutive delta frames; its emulator execution is pending. These simulations are not physical-device FPS measurements. At 150 ms RTT the single-outstanding-frame protocol still limits delivery to about 6–7 fps; this change does not claim 30 fps over that link.

Affected release artifacts: Core and Pro Android APKs, and their checksum files. Desktop renderer changes are tracked separately. No screen-capture permission was granted or bypassed during these tests.
