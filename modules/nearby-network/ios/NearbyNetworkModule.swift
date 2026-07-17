import ExpoModulesCore
import Foundation
import Network

public final class NearbyNetworkModule: Module {
  private let queue = DispatchQueue(label: "jeopardy.nearby-network")
  private var listener: NWListener?
  private var browser: NWBrowser?
  private var endpoints: [String: NWEndpoint] = [:]
  private var connections: [String: NWConnection] = [:]
  private var receiveBuffers: [String: Data] = [:]
  private let serviceType = "_jeopardy._tcp"
  private let maximumMessageBytes = 1_048_576

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

  private func parameters() -> NWParameters {
    let parameters = NWParameters.tcp
    parameters.includePeerToPeer = true
    return parameters
  }

  private func startHosting(roomCode: Int, displayName: String) {
    stopAll()
    do {
      let listener = try NWListener(using: parameters())
      let safeName = String(displayName.prefix(32))
      let txt = NWTXTRecord(["room": "\(roomCode)", "name": safeName])
      listener.service = NWListener.Service(name: UUID().uuidString, type: serviceType, txtRecord: txt)
      listener.stateUpdateHandler = { [weak self] state in
        self?.handleListenerState(state)
      }
      listener.newConnectionHandler = { [weak self] connection in
        guard let self else { return }
        self.queue.async { self.accept(connection) }
      }
      self.listener = listener
      listener.start(queue: queue)
    } catch {
      emitError("Could not host nearby game: \(error.localizedDescription)")
    }
  }

  private func startBrowsing() {
    stopAll()
    let browser = NWBrowser(for: .bonjour(type: serviceType, domain: nil), using: parameters())
    browser.stateUpdateHandler = { [weak self] state in
      switch state {
      case .ready:
        self?.sendEvent("onStateChanged", ["state": "browsing"])
      case .failed(let error):
        self?.emitError("Nearby browsing failed: \(error.localizedDescription)")
      case .waiting(let error):
        self?.sendEvent("onStateChanged", ["state": "waiting: \(error.localizedDescription)"])
      default:
        break
      }
    }
    browser.browseResultsChangedHandler = { [weak self] results, changes in
      guard let self else { return }
      self.queue.async { self.handleBrowseResults(results, changes: changes) }
    }
    self.browser = browser
    browser.start(queue: queue)
  }

  private func handleBrowseResults(
    _ results: Set<NWBrowser.Result>,
    changes: Set<NWBrowser.Result.Change>
  ) {
    let currentIds = Set(results.map { peerId(for: $0.endpoint) })
    for oldId in endpoints.keys where !currentIds.contains(oldId) {
      endpoints.removeValue(forKey: oldId)
      sendEvent("onPeerLost", ["peerId": oldId])
    }
    for result in results {
      let id = peerId(for: result.endpoint)
      endpoints[id] = result.endpoint
      guard case let .bonjour(metadata) = result.metadata,
            let roomText = metadata["room"],
            let roomCode = Int(roomText) else { continue }
      let name = metadata["name"] ?? "Nearby Game"
      sendEvent("onPeerFound", ["peerId": id, "name": name, "roomCode": roomCode])
    }
  }

  private func connectToPeer(_ peerId: String) {
    guard let endpoint = endpoints[peerId] else {
      emitError("Nearby game is no longer available")
      return
    }
    browser?.cancel()
    browser = nil
    startConnection(NWConnection(to: endpoint, using: parameters()), peerId: peerId)
  }

  private func accept(_ connection: NWConnection) {
    let peerId = UUID().uuidString
    startConnection(connection, peerId: peerId)
  }

  private func startConnection(_ connection: NWConnection, peerId: String) {
    connections[peerId] = connection
    receiveBuffers[peerId] = Data()
    connection.stateUpdateHandler = { [weak self, weak connection] state in
      guard let self, let connection else { return }
      self.queue.async { self.handleConnectionState(state, connection: connection, peerId: peerId) }
    }
    connection.start(queue: queue)
  }

  private func handleConnectionState(_ state: NWConnection.State, connection: NWConnection, peerId: String) {
    switch state {
    case .ready:
      sendEvent("onPeerConnected", ["peerId": peerId])
      receiveNext(on: connection, peerId: peerId)
    case .failed(let error):
      emitError("Nearby connection failed: \(error.localizedDescription)")
      removeConnection(peerId)
    case .cancelled:
      removeConnection(peerId)
    default:
      break
    }
  }

  private func receiveNext(on connection: NWConnection, peerId: String) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self, weak connection] data, _, complete, error in
      guard let self, let connection else { return }
      self.queue.async {
        if let data, !data.isEmpty {
          self.receiveBuffers[peerId, default: Data()].append(data)
          self.drainFrames(peerId: peerId)
        }
        if let error {
          self.emitError("Nearby receive failed: \(error.localizedDescription)")
          connection.cancel()
          return
        }
        if complete {
          connection.cancel()
          return
        }
        self.receiveNext(on: connection, peerId: peerId)
      }
    }
  }

  private func drainFrames(peerId: String) {
    guard var buffer = receiveBuffers[peerId] else { return }
    while buffer.count >= 4 {
      let length = buffer.prefix(4).reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
      if length > maximumMessageBytes {
        emitError("Nearby message exceeded the 1 MB limit")
        connections[peerId]?.cancel()
        return
      }
      let frameLength = 4 + Int(length)
      if buffer.count < frameLength { break }
      let payload = buffer.subdata(in: 4..<frameLength)
      buffer.removeSubrange(0..<frameLength)
      guard let message = String(data: payload, encoding: .utf8) else {
        emitError("Nearby peer sent invalid text")
        continue
      }
      sendEvent("onMessage", ["peerId": peerId, "message": message])
    }
    receiveBuffers[peerId] = buffer
  }

  private func sendMessage(_ message: String, to peerId: String) {
    guard let connection = connections[peerId], let payload = message.data(using: .utf8) else {
      emitError("Nearby peer is not connected")
      return
    }
    guard payload.count <= maximumMessageBytes else {
      emitError("Nearby message exceeded the 1 MB limit")
      return
    }
    var length = UInt32(payload.count).bigEndian
    var frame = withUnsafeBytes(of: &length) { Data($0) }
    frame.append(payload)
    connection.send(content: frame, completion: .contentProcessed { [weak self] error in
      if let error { self?.emitError("Nearby send failed: \(error.localizedDescription)") }
    })
  }

  private func handleListenerState(_ state: NWListener.State) {
    switch state {
    case .ready:
      sendEvent("onStateChanged", ["state": "hosting"])
    case .failed(let error):
      emitError("Nearby host failed: \(error.localizedDescription)")
    case .waiting(let error):
      sendEvent("onStateChanged", ["state": "waiting: \(error.localizedDescription)"])
    default:
      break
    }
  }

  private func removeConnection(_ peerId: String) {
    guard connections.removeValue(forKey: peerId) != nil else { return }
    receiveBuffers.removeValue(forKey: peerId)
    sendEvent("onPeerDisconnected", ["peerId": peerId])
  }

  private func peerId(for endpoint: NWEndpoint) -> String {
    if case let .service(name, type, domain, _) = endpoint {
      return "\(name)|\(type)|\(domain)"
    }
    return endpoint.debugDescription
  }

  private func stopAll() {
    listener?.cancel()
    listener = nil
    browser?.cancel()
    browser = nil
    let active = connections
    connections.removeAll()
    receiveBuffers.removeAll()
    endpoints.removeAll()
    for (peerId, connection) in active {
      connection.stateUpdateHandler = nil
      connection.cancel()
      sendEvent("onPeerDisconnected", ["peerId": peerId])
    }
    sendEvent("onStateChanged", ["state": "stopped"])
  }

  private func emitError(_ message: String) {
    sendEvent("onError", ["message": message])
  }
}
