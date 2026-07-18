import CoreBluetooth
import ExpoModulesCore
import Foundation

public final class BluetoothNetworkModule: Module {
  fileprivate let queue = DispatchQueue(label: "jeopardy.bluetooth-network")
  fileprivate let serviceUUID = CBUUID(string: "7D8F2E4D-4C53-4D4F-9D6E-4A7C37A1E001")
  fileprivate let txUUID = CBUUID(string: "7D8F2E4D-4C53-4D4F-9D6E-4A7C37A1E002")
  fileprivate let rxUUID = CBUUID(string: "7D8F2E4D-4C53-4D4F-9D6E-4A7C37A1E003")
  fileprivate let maximumMessageBytes = 1_048_576
  private let headerBytes = 9

  fileprivate lazy var delegateProxy = BluetoothNetworkDelegate(owner: self)
  fileprivate var role: Role?
  fileprivate var roomCode: Int?
  fileprivate var displayName = ""

  fileprivate var peripheralManager: CBPeripheralManager?
  fileprivate var centralManager: CBCentralManager?
  fileprivate var hostedService: CBMutableService?
  fileprivate var txCharacteristic: CBMutableCharacteristic?
  fileprivate var rxCharacteristic: CBMutableCharacteristic?
  fileprivate var discoveredPeripherals: [String: CBPeripheral] = [:]
  fileprivate var connectedPeripherals: [String: CBPeripheral] = [:]
  fileprivate var subscribedCentrals: [String: CBCentral] = [:]
  fileprivate var guestPeripheral: CBPeripheral?
  fileprivate var guestTxCharacteristic: CBCharacteristic?
  fileprivate var guestRxCharacteristic: CBCharacteristic?
  fileprivate var guestWriteInFlight = false

  fileprivate var outgoingChunks: [String: [Data]] = [:]
  fileprivate var incomingChunks: [String: IncomingMessage] = [:]
  fileprivate var nextMessageId: UInt32 = 1

  fileprivate enum Role {
    case host
    case guest
  }

  fileprivate struct IncomingMessage {
    let total: Int
    var chunks: [Int: Data]
  }

  public func definition() -> ModuleDefinition {
    Name("BluetoothNetwork")

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
    role = .host
    self.roomCode = roomCode
    self.displayName = displayName
    peripheralManager = CBPeripheralManager(delegate: delegateProxy, queue: queue)
  }

  private func startBrowsing() {
    stopAll()
    role = .guest
    centralManager = CBCentralManager(delegate: delegateProxy, queue: queue)
  }

  private func connectToPeer(_ peerId: String) {
    guard let centralManager, let peripheral = discoveredPeripherals[peerId] else {
      emitError("Bluetooth game is no longer available")
      return
    }
    guestPeripheral = peripheral
    centralManager.stopScan()
    centralManager.connect(peripheral)
  }

  private func sendMessage(_ message: String, to peerId: String) {
    guard let payload = message.data(using: .utf8), payload.count <= maximumMessageBytes else {
      emitError("Bluetooth message exceeded the 1 MB limit")
      return
    }
    guard role == .host || role == .guest else {
      emitError("Bluetooth is not connected")
      return
    }

    let maxPayload = maxPayloadBytes(for: peerId)
    let chunks = makeChunks(payload, maxPayload: maxPayload)
    if chunks.isEmpty { return }
    if peerId == "*" {
      for id in subscribedCentrals.keys {
        outgoingChunks[id, default: []].append(contentsOf: chunks)
        drainOutgoing(to: id)
      }
    } else {
      outgoingChunks[peerId, default: []].append(contentsOf: chunks)
      drainOutgoing(to: peerId)
    }
  }

  fileprivate func configureHostIfReady() {
    guard role == .host, let peripheralManager, peripheralManager.state == .poweredOn else { return }

    let service = CBMutableService(type: serviceUUID, primary: true)
    let tx = CBMutableCharacteristic(
      type: txUUID,
      properties: [.notify],
      value: nil,
      permissions: []
    )
    let rx = CBMutableCharacteristic(
      type: rxUUID,
      properties: [.write, .writeWithoutResponse],
      value: nil,
      permissions: [.writeable]
    )
    hostedService = service
    txCharacteristic = tx
    rxCharacteristic = rx
    service.characteristics = [tx, rx]
    peripheralManager.add(service)
  }

  fileprivate func startAdvertising() {
    guard
      role == .host,
      let peripheralManager,
      peripheralManager.state == .poweredOn,
      let roomCode
    else { return }

    let safeName = String(displayName.prefix(10)).replacingOccurrences(of: ":", with: "")
    let localName = "J\(String(roomCode).padLeft(to: 3)):\(safeName)"
    peripheralManager.startAdvertising([
      CBAdvertisementDataServiceUUIDsKey: [serviceUUID],
      CBAdvertisementDataLocalNameKey: localName,
    ])
  }

  fileprivate func startScanningIfReady() {
    guard role == .guest, let centralManager, centralManager.state == .poweredOn else { return }
    centralManager.scanForPeripherals(withServices: [serviceUUID], options: [
      CBCentralManagerScanOptionAllowDuplicatesKey: false,
    ])
    sendEvent("onStateChanged", ["state": "browsing"])
  }

  fileprivate func drainOutgoing(to peerId: String) {
    guard var queue = outgoingChunks[peerId], !queue.isEmpty else { return }

    if role == .host {
      guard
        let peripheralManager,
        let txCharacteristic,
        let central = subscribedCentrals[peerId]
      else { return }
      while !queue.isEmpty {
        if !peripheralManager.updateValue(queue[0], for: txCharacteristic, onSubscribedCentrals: [central]) {
          break
        }
        queue.removeFirst()
      }
      outgoingChunks[peerId] = queue.isEmpty ? nil : queue
      return
    }

    if role == .guest {
      guard
        !guestWriteInFlight,
        let peripheral = guestPeripheral,
        let rx = guestRxCharacteristic,
        peerId == peripheral.identifier.uuidString
      else { return }
      let chunk = queue.removeFirst()
      outgoingChunks[peerId] = queue.isEmpty ? nil : queue
      guestWriteInFlight = true
      peripheral.writeValue(chunk, for: rx, type: .withResponse)
    }
  }

  fileprivate func receiveChunk(_ data: Data, from peerId: String) {
    guard data.count >= headerBytes, data[0] == 0x4a else { return }
    let messageId = UInt32(data[1]) << 24 | UInt32(data[2]) << 16 | UInt32(data[3]) << 8 | UInt32(data[4])
    let sequence = Int(UInt16(data[5]) << 8 | UInt16(data[6]))
    let total = Int(UInt16(data[7]) << 8 | UInt16(data[8]))
    guard total > 0, sequence < total else { return }
    let payload = data.subdata(in: headerBytes..<data.count)
    let key = "\(peerId):\(messageId)"
    var incoming = incomingChunks[key] ?? IncomingMessage(total: total, chunks: [:])
    incoming.chunks[sequence] = payload
    if incoming.chunks.count < incoming.total {
      incomingChunks[key] = incoming
      return
    }

    incomingChunks.removeValue(forKey: key)
    var messageData = Data()
    for i in 0..<incoming.total {
      guard let chunk = incoming.chunks[i] else { return }
      messageData.append(chunk)
    }
    guard messageData.count <= maximumMessageBytes else {
      emitError("Bluetooth message exceeded the 1 MB limit")
      return
    }
    guard let message = String(data: messageData, encoding: .utf8) else {
      emitError("Bluetooth peer sent invalid text")
      return
    }
    sendEvent("onMessage", ["peerId": peerId, "message": message])
  }

  private func makeChunks(_ payload: Data, maxPayload: Int) -> [Data] {
    let payloadSize = max(1, maxPayload)
    let total = Int(ceil(Double(payload.count) / Double(payloadSize)))
    guard total <= Int(UInt16.max) else {
      emitError("Bluetooth message is too large to chunk")
      return []
    }

    let messageId = nextMessageId
    nextMessageId = nextMessageId == UInt32.max ? 1 : nextMessageId + 1
    return (0..<total).map { sequence in
      let start = sequence * payloadSize
      let end = min(payload.count, start + payloadSize)
      var chunk = Data()
      chunk.append(0x4a)
      chunk.append(UInt8((messageId >> 24) & 0xff))
      chunk.append(UInt8((messageId >> 16) & 0xff))
      chunk.append(UInt8((messageId >> 8) & 0xff))
      chunk.append(UInt8(messageId & 0xff))
      chunk.append(UInt8((UInt16(sequence) >> 8) & 0xff))
      chunk.append(UInt8(UInt16(sequence) & 0xff))
      chunk.append(UInt8((UInt16(total) >> 8) & 0xff))
      chunk.append(UInt8(UInt16(total) & 0xff))
      chunk.append(payload.subdata(in: start..<end))
      return chunk
    }
  }

  private func maxPayloadBytes(for peerId: String) -> Int {
    let maxLength: Int
    if role == .host, let central = subscribedCentrals[peerId] {
      maxLength = central.maximumUpdateValueLength
    } else if role == .guest, let peripheral = guestPeripheral {
      maxLength = peripheral.maximumWriteValueLength(for: .withResponse)
    } else {
      maxLength = 182
    }
    return max(1, min(160, maxLength - headerBytes))
  }

  private func stopAll() {
    if let peripheralManager {
      peripheralManager.stopAdvertising()
      if let service = hostedService {
        peripheralManager.remove(service)
      }
    }
    centralManager?.stopScan()
    if let guestPeripheral {
      centralManager?.cancelPeripheralConnection(guestPeripheral)
    }

    let disconnected = Set(subscribedCentrals.keys).union(connectedPeripherals.keys)
    peripheralManager?.delegate = nil
    centralManager?.delegate = nil
    guestPeripheral?.delegate = nil
    for peripheral in connectedPeripherals.values {
      peripheral.delegate = nil
    }

    role = nil
    roomCode = nil
    displayName = ""
    peripheralManager = nil
    centralManager = nil
    hostedService = nil
    txCharacteristic = nil
    rxCharacteristic = nil
    discoveredPeripherals.removeAll()
    connectedPeripherals.removeAll()
    subscribedCentrals.removeAll()
    guestPeripheral = nil
    guestTxCharacteristic = nil
    guestRxCharacteristic = nil
    guestWriteInFlight = false
    outgoingChunks.removeAll()
    incomingChunks.removeAll()

    for peerId in disconnected {
      sendEvent("onPeerDisconnected", ["peerId": peerId])
    }
    sendEvent("onStateChanged", ["state": "stopped"])
  }

  fileprivate func emitError(_ message: String) {
    sendEvent("onError", ["message": message])
  }
}

private final class BluetoothNetworkDelegate: NSObject, CBPeripheralManagerDelegate, CBCentralManagerDelegate, CBPeripheralDelegate {
  private weak var owner: BluetoothNetworkModule?

  init(owner: BluetoothNetworkModule) {
    self.owner = owner
  }

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    guard let owner else { return }
    switch peripheral.state {
    case .poweredOn:
      owner.configureHostIfReady()
    case .poweredOff:
      owner.emitError("Bluetooth is off")
    case .unauthorized:
      owner.emitError("Bluetooth permission is not allowed")
    case .unsupported:
      owner.emitError("Bluetooth is not supported on this device")
    default:
      owner.sendEvent("onStateChanged", ["state": "waiting: bluetooth \(peripheral.state.rawValue)"])
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    guard let owner else { return }
    if let error {
      owner.emitError("Bluetooth host failed: \(error.localizedDescription)")
      return
    }
    owner.startAdvertising()
  }

  func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
    guard let owner else { return }
    if let error {
      owner.emitError("Bluetooth host failed: \(error.localizedDescription)")
      return
    }
    owner.sendEvent("onStateChanged", ["state": "hosting"])
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
    guard let owner else { return }
    let id = central.identifier.uuidString
    owner.subscribedCentrals[id] = central
    owner.sendEvent("onPeerConnected", ["peerId": id])
    owner.drainOutgoing(to: id)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
    guard let owner else { return }
    let id = central.identifier.uuidString
    owner.subscribedCentrals.removeValue(forKey: id)
    owner.sendEvent("onPeerDisconnected", ["peerId": id])
  }

  func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
    guard let owner else { return }
    for id in owner.subscribedCentrals.keys {
      owner.drainOutgoing(to: id)
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    guard let owner else { return }
    for request in requests {
      guard request.characteristic.uuid == owner.rxUUID, let value = request.value else { continue }
      owner.receiveChunk(value, from: request.central.identifier.uuidString)
      peripheral.respond(to: request, withResult: .success)
    }
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    guard let owner else { return }
    switch central.state {
    case .poweredOn:
      owner.startScanningIfReady()
    case .poweredOff:
      owner.emitError("Bluetooth is off")
    case .unauthorized:
      owner.emitError("Bluetooth permission is not allowed")
    case .unsupported:
      owner.emitError("Bluetooth is not supported on this device")
    default:
      owner.sendEvent("onStateChanged", ["state": "waiting: bluetooth \(central.state.rawValue)"])
    }
  }

  func centralManager(
    _ central: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi RSSI: NSNumber
  ) {
    guard let owner else { return }
    let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? peripheral.name ?? ""
    guard name.hasPrefix("J"), name.count >= 4 else { return }
    let codeText = String(name.dropFirst().prefix(3))
    guard let roomCode = Int(codeText) else { return }
    let displayName = name.split(separator: ":", maxSplits: 1).dropFirst().first.map(String.init) ?? "Bluetooth Game"
    let id = peripheral.identifier.uuidString
    owner.discoveredPeripherals[id] = peripheral
    owner.sendEvent("onPeerFound", ["peerId": id, "name": displayName, "roomCode": roomCode])
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    guard let owner else { return }
    let id = peripheral.identifier.uuidString
    owner.connectedPeripherals[id] = peripheral
    peripheral.delegate = self
    peripheral.discoverServices([owner.serviceUUID])
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    guard let owner else { return }
    owner.emitError("Bluetooth connection failed: \(error?.localizedDescription ?? "Unknown error")")
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    guard let owner else { return }
    let id = peripheral.identifier.uuidString
    owner.connectedPeripherals.removeValue(forKey: id)
    owner.sendEvent("onPeerDisconnected", ["peerId": id])
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard let owner else { return }
    if let error {
      owner.emitError("Bluetooth service discovery failed: \(error.localizedDescription)")
      return
    }
    for service in peripheral.services ?? [] where service.uuid == owner.serviceUUID {
      peripheral.discoverCharacteristics([owner.txUUID, owner.rxUUID], for: service)
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard let owner else { return }
    if let error {
      owner.emitError("Bluetooth characteristic discovery failed: \(error.localizedDescription)")
      return
    }
    for characteristic in service.characteristics ?? [] {
      if characteristic.uuid == owner.txUUID {
        owner.guestTxCharacteristic = characteristic
        peripheral.setNotifyValue(true, for: characteristic)
      } else if characteristic.uuid == owner.rxUUID {
        owner.guestRxCharacteristic = characteristic
      }
    }
    if owner.guestTxCharacteristic != nil && owner.guestRxCharacteristic != nil {
      owner.sendEvent("onPeerConnected", ["peerId": peripheral.identifier.uuidString])
      owner.drainOutgoing(to: peripheral.identifier.uuidString)
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard let owner else { return }
    if let error {
      owner.emitError("Bluetooth receive failed: \(error.localizedDescription)")
      return
    }
    guard characteristic.uuid == owner.txUUID, let value = characteristic.value else { return }
    owner.receiveChunk(value, from: peripheral.identifier.uuidString)
  }

  func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    guard let owner else { return }
    owner.guestWriteInFlight = false
    if let error {
      owner.emitError("Bluetooth send failed: \(error.localizedDescription)")
      return
    }
    owner.drainOutgoing(to: peripheral.identifier.uuidString)
  }
}

private extension String {
  func padLeft(to length: Int) -> String {
    if count >= length { return self }
    return String(repeating: "0", count: length - count) + self
  }
}
