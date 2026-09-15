import Foundation
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count >= 2 else { FileHandle.standardError.write("usage: ocr <image>\n".data(using:.utf8)!); exit(2) }
guard let img = NSImage(contentsOfFile: args[1]),
      let tiff = img.tiffRepresentation,
      let bmp = NSBitmapImageRep(data: tiff),
      let cg = bmp.cgImage else { FileHandle.standardError.write("cannot load image\n".data(using:.utf8)!); exit(3) }

let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.usesLanguageCorrection = false
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
do {
  try handler.perform([req])
  if let obs = req.results {
    for o in obs { if let top = o.topCandidates(1).first { print(top.string) } }
  }
} catch { FileHandle.standardError.write("ocr error: \(error)\n".data(using:.utf8)!); exit(4) }
