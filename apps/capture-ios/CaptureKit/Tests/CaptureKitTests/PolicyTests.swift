import Foundation
import Testing
@testable import CaptureKit

private func at(_ x: Double, yaw: Double = 0) -> Pose { .standing(at: [x, 1.5, 0], yaw: yaw) }

@Suite("Capture rules")
struct PolicyTests {
    @Test("keeps a depth frame only after the camera moves enough")
    func keyframes() {
        var gate = KeyframeGate()
        #expect(gate.consider(pose: at(0), t: 0, tracking: .normal, waitingWrites: 0) == .keep)
        #expect(gate.consider(pose: at(0.03, yaw: 0.05), t: 0.5, tracking: .normal, waitingWrites: 0) == .motion)
        #expect(gate.consider(pose: at(0.05), t: 0.6, tracking: .normal, waitingWrites: 0) == .keep)
        #expect(gate.consider(pose: at(0.5), t: 0.65, tracking: .normal, waitingWrites: 0) == .interval)
        #expect(gate.consider(pose: at(1), t: 2, tracking: .normal, waitingWrites: 4) == .busy)
        #expect(gate.consider(pose: at(1), t: 2, tracking: .limited, waitingWrites: 0) == .tracking)
    }

    @Test("holds a frame and keeps it as soon as it is sharp")
    func keepsSharpFrames() {
        var selector = PhotoSelector()
        #expect(selector.offer(PhotoCandidate(id: "a", pose: at(0), t: 0, blurPx: 3)).isEmpty)
        #expect(selector.heldID == "a")
        // Not sharper by enough: "a" stays held.
        _ = selector.offer(PhotoCandidate(id: "x", pose: at(0.01), t: 0.05, blurPx: 2.8))
        #expect(selector.heldID == "a")
        // Clearly sharper and sharp enough: kept at once.
        #expect(selector.offer(PhotoCandidate(id: "b", pose: at(0.01), t: 0.1, blurPx: 1.2)).map(\.id) == ["b"])
    }

    @Test("keeps the held frame when the view moves on, and skips views already taken")
    func movesOn() {
        var selector = PhotoSelector()
        _ = selector.offer(PhotoCandidate(id: "a", pose: at(0), t: 0, blurPx: 2.5))
        #expect(selector.offer(PhotoCandidate(id: "b", pose: at(0.5), t: 0.3, blurPx: 2.5)).map(\.id) == ["a"])
        // Back at the first view: too close to a photo already kept.
        _ = selector.flush()
        #expect(selector.offer(PhotoCandidate(id: "c", pose: at(0.05), t: 1, blurPx: 1)).isEmpty)
    }

    @Test("never keeps a frame blurrier than the limit")
    func blurLimit() {
        var selector = PhotoSelector(limits: .photoreal)
        #expect(selector.offer(PhotoCandidate(id: "a", pose: at(0), t: 0, blurPx: 4)).isEmpty)
        #expect(selector.flush().isEmpty)
    }

    @Test("rations full-resolution stills and keeps only matching ones")
    func stills() {
        let policy = StillPolicy()
        #expect(policy.mayRequest(now: 10, lastStill: 8, thermalNominal: true, enabled: true) == false)
        #expect(policy.mayRequest(now: 11.5, lastStill: 8, thermalNominal: true, enabled: true))
        #expect(policy.mayRequest(now: 20, lastStill: nil, thermalNominal: false, enabled: true) == false)
        let held = PhotoCandidate(id: "p", pose: at(0), t: 0, blurPx: 1)
        // 3.5 px on a 4032 px still is 1.67 px at 1920 px: within 1.2 × 1.5 px.
        #expect(policy.accept(stillPose: at(0.1), stillBlurPx: 3.5, stillWidth: 4032, held: held))
        #expect(policy.accept(stillPose: at(0.1), stillBlurPx: 4, stillWidth: 4032, held: held) == false)
        #expect(policy.accept(stillPose: at(0.3), stillBlurPx: 1, stillWidth: 4032, held: held) == false)
    }

    @Test("asks for one still at a time, and drops one that comes back too late")
    func stillRequests() {
        var requests = StillRequests()
        var asks: [Bool] = []
        asks.append(requests.ask(for: "p1", now: 10, thermalNominal: true, enabled: true))
        asks.append(requests.ask(for: "p2", now: 11, thermalNominal: true, enabled: true))
        #expect(asks == [true, false])
        let late = requests.arrived(now: 14.5)
        #expect(late == nil)
        let next = requests.ask(for: "p3", now: 20, thermalNominal: true, enabled: true)
        let onTime = requests.arrived(now: 20.4)
        #expect(next && onTime == "p3")
        // Rationed: one second after the last is too soon.
        let soon = requests.ask(for: "p4", now: 21, thermalNominal: true, enabled: true)
        #expect(soon == false)
    }

    @Test("forgets a still that never comes back, so the next can be asked for")
    func lostStill() {
        var requests = StillRequests()
        let asks = [0.0, 2, 4].enumerated().map { i, now in requests.ask(for: "p\(i + 1)", now: now, thermalNominal: true, enabled: true) }
        #expect(asks == [true, false, true])
        #expect(requests.waiting == StillRequests.Waiting(forID: "p3", askedAt: 4))
    }

    @Test("keeps white balance gains where the camera accepts them")
    func whiteBalanceGains() {
        #expect(WhiteBalanceLock.clamp([2.1, 0.98, 1.7], max: 4) == [2.1, 1, 1.7])
        #expect(WhiteBalanceLock.clamp([5, 1, 3], max: 4) == [4, 1, 3])
    }

    @Test("tells the person what to do when tracking is not good", arguments: [
        (Tracking.normal, TrackingReason?.none, true, nil),
        (.normal, nil, false, "Hold steady"),
        (.limited, .excessiveMotion, false, "more slowly"),
        (.limited, .insufficientFeatures, false, "turn on a light"),
        (.limited, .relocalizing, false, "Go back"),
        (.notAvailable, nil, false, "Tracking stopped"),
    ] as [(Tracking, TrackingReason?, Bool, String?)])
    func trackingAdvice(tracking: Tracking, reason: TrackingReason?, open: Bool, says: String?) {
        let message = TrackingAdvice.message(tracking: tracking, reason: reason, gateOpen: open)
        if let says { #expect(message?.contains(says) == true) } else { #expect(message == nil) }
    }

    @Test("passes on the scanner's request only while tracking is good")
    func scannerInstructions() {
        #expect(TrackingAdvice.message(tracking: .normal, reason: nil, gateOpen: true, instruction: .turnOnLight) == "Too dark: turn on a light.")
        #expect(TrackingAdvice.message(tracking: .normal, reason: nil, gateOpen: true, instruction: .normal) == nil)
        #expect(TrackingAdvice.message(tracking: .limited, reason: .excessiveMotion, gateOpen: false, instruction: .moveCloseToWall)?.contains("more slowly") == true)
    }

    @Test("stops at once when tracking degrades and resumes after 1.5 s of good tracking")
    func tracking() {
        var gate = TrackingGate()
        _ = gate.frame(tracking: .normal, pose: at(0), t: 0, frameAgeS: 0)
        #expect(gate.frame(tracking: .normal, pose: at(0), t: 1.6, frameAgeS: 0) == [.resumed])
        #expect(gate.frame(tracking: .limited, pose: at(0), t: 1.7, frameAgeS: 0) == [.lost])
        #expect(gate.frame(tracking: .normal, pose: at(0), t: 2.0, frameAgeS: 0).isEmpty)
        #expect(gate.open == false)
        #expect(gate.frame(tracking: .normal, pose: at(0.8), t: 2.1, frameAgeS: 0) == [.jumped(metres: 0.8)])
    }

    @Test("eases off when the phone is hot or short of memory")
    func budget() {
        #expect(CaptureBudget.current(thermal: .nominal, secondsSinceMemoryWarning: nil, photosInRoom: 10) == .normal)
        #expect(CaptureBudget.current(thermal: .serious, secondsSinceMemoryWarning: nil, photosInRoom: 10) == .strained)
        #expect(CaptureBudget.current(thermal: .nominal, secondsSinceMemoryWarning: 30, photosInRoom: 10) == .strained)
        #expect(CaptureBudget.current(thermal: .critical, secondsSinceMemoryWarning: nil, photosInRoom: 0) == .critical)
        #expect(CaptureBudget.canStart(freeBytes: 400_000_000) == false)
    }

    @Test("says a room is ready, or that more scanning adds little")
    func verdict() {
        #expect(RoomVerdict.judge(walls: 4, photos: 10, coverage: 0.9, coverageWindowAgo: 0.8, elapsedS: 60).ready)
        let slow = RoomVerdict.judge(walls: 4, photos: 10, coverage: 0.7, coverageWindowAgo: 0.69, elapsedS: 150)
        #expect(slow.ready == false && slow.canStop)
    }
}
