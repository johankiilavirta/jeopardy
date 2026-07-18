import ExpoModulesCore
import Foundation
import MultipeerConnectivity

public final class NearbyNetworkModule: Module {
  fileprivate let queue = DispatchQueue(label: "jeopardy.nearby-network")
  private let serviceType = "jeopardy"
  fileprivate let maximumMessageBytes = 1_048_576

  private lazy var delegateProxy = NearbyNetworkDelegate(owner: self)
  private var localPeer: MCPeerID?
  fileprivate var session: MCSession?
  private var advertiser: MCNearbyServiceAdvertiser?
  private var browser: MCNearbyServiceBrowser?
  fileprivate var foundPeers: [String: MCPeerID] = [:]
  fileprivate var connectedPeers: [String: MCPeerID] = [:]
  private var roomCode: Int?

  public func definition() -> ModuleDefinition {
    Name("NearbyNetwork")

    Events(
      "onPeerFound",
      "onPeerLost",
      "onPeerConnected",
      "onPeerDisconnected",
      "onMessage",
      "onStateChanged",
      "onError"
    )

    Function("host") { (roomCode: Int, displayName: String) in
      self.queue.async { self.startHosting(roomCode: roomCode, displayName: displayName) }
    }

    Function("browse") {
      self.queue.async { self.startBrowsing() }
    }

    Function("connect") { (peerId: String) in
      self.queue.async { self.connectToPeer(peerId) }
    }

    Function("send") { (peerId: String, message: String) in
      self.queue.async { self.sendMessage(message, to: peerId) }
    }

    Function("stop") {
      self.queue.async { self.stopAll() }
    }

    OnDestroy {
      self.queue.async { self.stopAll() }
    }
  }

  private func startHosting(roomCode: Int, displayName: String) {
    stopAll()
    self.roomCode = roomCode

    let peer = makePeer(displayName: displayName)
    let session = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .required)
    session.delegate = delegateProxy

    let advertiser = MCNearbyServiceAdvertiser(
      peer: peer,
      discoveryInfo: [
        "room": "\(roomCode)",
        "name": String(displayName.prefix(32)),
      ],
      serviceType: serviceType
    )
    advertiser.delegate = delegateProxy

    self.localPeer = peer
    self.session = session
    self.advertiser = advertiser
    advertiser.startAdvertisingPeer()
    sendEvent("onStateChanged", ["state": "hosting"])
  }

  private func startBrowsing() {
    stopAll()

    let peer = makePeer(displayName: "guest")
    let session = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .required)
    session.delegate = delegateProxy

    let browser = MCNearbyServiceBrowser(peer: peer, serviceType: serviceType)
    browser.delegate = delegateProxy

    self.localPeer = peer
    self.session = session
    self.browser = browser
    browser.startBrowsingForPeers()
    sendEvent("onStateChanged", ["state": "browsing"])
  }

  private func connectToPeer(_ peerId: String) {
    guard let browser, let session, let peer = foundPeers[peerId] else {
      emitError("Nearby game is no longer available")
      return
    }
    browser.invitePeer(peer, to: session, withContext: nil, timeout: 20)
  }

  private func sendMessage(_ message: String, to peerId: String) {
    guard let session else {
      emitError("Nearby peer is not connected")
      return
    }
    guard let payload = message.data(using: .utf8), payload.count <= maximumMessageBytes else {
      emitError("Nearby message exceeded the 1 MB limit")
      return
    }
    let peers: [MCPeerID]
    if peerId == "*" {
      peers = session.connectedPeers
    } else if let peer = connectedPeers[peerId] {
      peers = [peer]
    } else {
      emitError("Nearby peer is not connected")
      return
    }
    guard !peers.isEmpty else {
      emitError("Nearby peer is not connected")
      return
    }
    do {
      try session.send(payload, toPeers: peers, with: .reliable)
    } catch {
      emitError("Nearby send failed: \(error.localizedDescription)")
    }
  }

  private func stopAll() {
    advertiser?.stopAdvertisingPeer()
    advertiser?.delegate = nil
    advertiser = nil

    browser?.stopBrowsingForPeers()
    browser?.delegate = nil
    browser = nil

    let disconnected = Array(connectedPeers.keys)
    session?.disconnect()
    session?.delegate = nil
    session = nil
    localPeer = nil
    foundPeers.removeAll()
    connectedPeers.removeAll()
    roomCode = nil

    for peerId in disconnected {
      sendEvent("onPeerDisconnected", ["peerId": peerId])
    }
    sendEvent("onStateChanged", ["state": "stopped"])
  }

  private func makePeer(displayName: String) -> MCPeerID {
    let safeName = String(displayName.prefix(32)).isEmpty ? "player" : String(displayName.prefix(32))
    return MCPeerID(displayName: "\(safeName)-\(UUID().uuidString.prefix(8))")
  }

  fileprivate func peerKey(_ peerID: MCPeerID) -> String {
    peerID.displayName
  }

  fileprivate func emitError(_ message: String) {
    sendEvent("onError", ["message": message])
  }
}

private final class NearbyNetworkDelegate: NSObject, MCSessionDelegate, MCNearbyServiceAdvertiserDelegate, MCNearbyServiceBrowserDelegate {
  private weak var owner: NearbyNetworkModule?

  init(owner: NearbyNetworkModule) {
    self.owner = owner
  }

  // MARK: - MCNearbyServiceAdvertiserDelegate

  func advertiser(
    _ advertiser: MCNearbyServiceAdvertiser,
    didReceiveInvitationFromPeer peerID: MCPeerID,
    withContext context: Data?,
    invitationHandler: @escaping (Bool, MCSession?) -> Void
  ) {
    guard let owner else { return invitationHandler(false, nil) }
    owner.queue.async {
      invitationHandler(true, owner.session)
    }
  }

  func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) {
    guard let owner else { return }
    owner.queue.async {
      owner.emitError("Nearby host failed: \(error.localizedDescription)")
    }
  }

  // MARK: - MCNearbyServiceBrowserDelegate

  func browser(
    _ browser: MCNearbyServiceBrowser,
    foundPeer peerID: MCPeerID,
    withDiscoveryInfo info: [String: String]?
  ) {
    guard let owner else { return }
    owner.queue.async {
      guard let roomText = info?["room"], let roomCode = Int(roomText) else { return }
      let id = owner.peerKey(peerID)
      owner.foundPeers[id] = peerID
      owner.sendEvent("onPeerFound", [
        "peerId": id,
        "name": info?["name"] ?? "Nearby Game",
        "roomCode": roomCode,
      ])
    }
  }

  func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
    guard let owner else { return }
    owner.queue.async {
      let id = owner.peerKey(peerID)
      owner.foundPeers.removeValue(forKey: id)
      owner.sendEvent("onPeerLost", ["peerId": id])
    }
  }

  func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
    guard let owner else { return }
    owner.queue.async {
      owner.emitError("Nearby browsing failed: \(error.localizedDescription)")
    }
  }

  // MARK: - MCSessionDelegate

  func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
    guard let owner else { return }
    owner.queue.async {
      let id = owner.peerKey(peerID)
      switch state {
      case .connected:
        owner.connectedPeers[id] = peerID
        owner.sendEvent("onPeerConnected", ["peerId": id])
      case .notConnected:
        if owner.connectedPeers.removeValue(forKey: id) != nil {
          owner.sendEvent("onPeerDisconnected", ["peerId": id])
        }
      case .connecting:
        owner.sendEvent("onStateChanged", ["state": "connecting"])
      @unknown default:
        break
      }
    }
  }

  func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
    guard let owner else { return }
    owner.queue.async {
      guard data.count <= owner.maximumMessageBytes else {
        owner.emitError("Nearby message exceeded the 1 MB limit")
        return
      }
      guard let message = String(data: data, encoding: .utf8) else {
        owner.emitError("Nearby peer sent invalid text")
        return
      }
      owner.sendEvent("onMessage", ["peerId": owner.peerKey(peerID), "message": message])
    }
  }

  func session(
    _ session: MCSession,
    didReceive stream: InputStream,
    withName streamName: String,
    fromPeer peerID: MCPeerID
  ) {}

  func session(
    _ session: MCSession,
    didStartReceivingResourceWithName resourceName: String,
    fromPeer peerID: MCPeerID,
    with progress: Progress
  ) {}

  func session(
    _ session: MCSession,
    didFinishReceivingResourceWithName resourceName: String,
    fromPeer peerID: MCPeerID,
    at localURL: URL?,
    withError error: Error?
  ) {}
}
