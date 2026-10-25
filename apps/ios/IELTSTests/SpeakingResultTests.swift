import XCTest
@testable import IELTS

final class SpeakingResultTests: XCTestCase {
    func testDictionaryParse() {
        let json = #"[{"phonetic":"/ˈspiː.ʃiːz/","phonetics":[{"text":"/ˈspiː.ʃiːz/","audio":""},{"audio":"https://x/species-uk.mp3"},{"audio":"https://x/species-us.mp3"}]}]"#
        XCTAssertEqual(PronDict.parse(Data(json.utf8)), PronDict.Entry(uk: "https://x/species-uk.mp3", us: "https://x/species-us.mp3", ipa: "/ˈspiː.ʃiːz/"))
        // an unmarked recording counts as US when there is no UK one; IPA falls back to the phonetics text
        let plain = #"[{"phonetics":[{"text":"/kæt/"},{"audio":"https://x/cat.mp3"}]}]"#
        XCTAssertEqual(PronDict.parse(Data(plain.utf8)), PronDict.Entry(uk: nil, us: "https://x/cat.mp3", ipa: "/kæt/"))
        XCTAssertEqual(PronDict.parse(Data(#"{"title":"No Definitions Found"}"#.utf8)), PronDict.Entry())
    }

    func testPronunciationAudioDecodes() throws {
        let p = try JSONDecoder().decode(AnalysisResult.Pronunciation.self, from: Data(#"{"unclear":[],"audio":{"accuracy":null,"words":[{"word":"think","score":61,"accent":null,"start":1.2,"end":1.5,"phones":[{"expected":"θ","heard":"t","ok":false}]}],"confusions":[],"wordsPerMinute":null}}"#.utf8))
        XCTAssertEqual(p.audio?.words.first?.phones.first?.heard, "t")
        XCTAssertNil(p.audio?.accuracy)
        let old = try JSONDecoder().decode(AnalysisResult.Relevance.self, from: Data(#"{"questionIdx":0,"onTopic":true,"note":""}"#.utf8))
        XCTAssertNil(old.development)
    }

    func testOffTopicPenaltyAndDevelopment() {
        XCTAssertEqual(resOffTopicPenaltyText(nil), "")
        XCTAssertEqual(resOffTopicPenaltyText(0), "")
        XCTAssertEqual(resOffTopicPenaltyText(0.2), " Off-topic speech can’t count as evidence, so your band is about 0.5 lower.")
        XCTAssertEqual(resOffTopicPenaltyText(1.3), " Off-topic speech can’t count as evidence, so your band is about 1.5 lower.")
        XCTAssertEqual(resDevelopment("none")?.label, "Not developed")
        XCTAssertEqual(resDevelopment("full")?.tip, "")
        XCTAssertNil(resDevelopment(nil))
    }
}
