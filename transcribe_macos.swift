import Foundation
import Speech
import AVFoundation

struct Output: Codable {
    struct Word: Codable { let start: Double; let end: Double; let word: String }
    struct Segment: Codable { let start: Double; let end: Double; let text: String; let words: [Word] }
    let segments: [Segment]
}

// Speech callbacks may need the main run loop. Never block it with a semaphore.
final class RecognitionState: @unchecked Sendable {
    private let lock = NSLock()
    private var authorization: SFSpeechRecognizerAuthorizationStatus = .notDetermined
    private var authorizationFinished = false
    private var output: Output?
    private var errorMessage: String?
    private var recognitionFinished = false

    func setAuthorization(_ value: SFSpeechRecognizerAuthorizationStatus) {
        lock.lock(); defer { lock.unlock() }
        authorization = value
        authorizationFinished = true
    }
    func authorizationSnapshot() -> (SFSpeechRecognizerAuthorizationStatus, Bool) {
        lock.lock(); defer { lock.unlock() }
        return (authorization, authorizationFinished)
    }
    func finish(output: Output? = nil, error: String? = nil) {
        lock.lock(); defer { lock.unlock() }
        guard !recognitionFinished else { return }
        self.output = output
        errorMessage = error
        recognitionFinished = true
    }
    func recognitionSnapshot() -> (Output?, String?, Bool) {
        lock.lock(); defer { lock.unlock() }
        return (output, errorMessage, recognitionFinished)
    }
}

func waitOnMainRunLoop(timeout: TimeInterval, until condition: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while !condition() && Date() < deadline {
        _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.1))
    }
    return condition()
}

let args = CommandLine.arguments
guard args.count >= 4 else {
    fputs("Uso: transcribe.swift <video_o_audio> <es|en> <json_salida>\n", stderr)
    exit(2)
}
let input = URL(fileURLWithPath: args[1])
let lang = args[2] == "en" ? "en-US" : "es-ES"
let outputURL = URL(fileURLWithPath: args[3])
let locale = Locale(identifier: lang)
guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
    fputs("El reconocimiento de voz no está disponible para \(lang).\n", stderr)
    exit(3)
}

let state = RecognitionState()
let initialAuthorization = SFSpeechRecognizer.authorizationStatus()
if initialAuthorization == .notDetermined {
    SFSpeechRecognizer.requestAuthorization { status in state.setAuthorization(status) }
    let authorizedInTime = waitOnMainRunLoop(timeout: 30) { state.authorizationSnapshot().1 }
    if !authorizedInTime {
        fputs("Tiempo de espera agotado al solicitar permiso de reconocimiento de voz.\n", stderr)
        exit(4)
    }
} else {
    state.setAuthorization(initialAuthorization)
}
guard state.authorizationSnapshot().0 == .authorized else {
    fputs("Permiso de reconocimiento de voz denegado. Actívalo en Ajustes del Sistema > Privacidad y seguridad.\n", stderr)
    exit(4)
}

let request = SFSpeechURLRecognitionRequest(url: input)
request.shouldReportPartialResults = false
request.requiresOnDeviceRecognition = true
if #available(macOS 13.0, *) { request.addsPunctuation = true }

_ = recognizer.recognitionTask(with: request) { result, error in
    if let error = error {
        state.finish(error: error.localizedDescription)
        return
    }
    guard let result = result, result.isFinal else { return }
    let parts = result.bestTranscription.segments
    let words = parts.map { p in
        Output.Word(start: p.timestamp, end: p.timestamp + p.duration, word: p.substring)
    }
    var grouped: [Output.Segment] = []
    var bucket: [Output.Word] = []
    func flush() {
        guard let first = bucket.first, let last = bucket.last else { return }
        let text = bucket.map { $0.word }.joined(separator: " ")
        grouped.append(Output.Segment(start: first.start, end: last.end, text: text, words: bucket))
        bucket.removeAll(keepingCapacity: true)
    }
    for word in words {
        if let previous = bucket.last, word.start - previous.end > 0.9 { flush() }
        bucket.append(word)
        if word.word.rangeOfCharacter(from: CharacterSet(charactersIn: ".!?。？！")) != nil { flush() }
    }
    flush()
    state.finish(output: Output(segments: grouped))
}

guard waitOnMainRunLoop(timeout: 60 * 60, until: { state.recognitionSnapshot().2 }) else {
    fputs("Tiempo de espera agotado en el reconocimiento local.\n", stderr)
    exit(5)
}
let (resultData, failure, _) = state.recognitionSnapshot()
if let failure = failure { fputs(failure + "\n", stderr); exit(6) }
guard let data = resultData else { fputs("No se obtuvo transcripción.\n", stderr); exit(7) }
do {
    let encoded = try JSONEncoder().encode(data)
    try encoded.write(to: outputURL, options: .atomic)
} catch {
    fputs("No se pudo guardar el JSON: \(error)\n", stderr)
    exit(8)
}
