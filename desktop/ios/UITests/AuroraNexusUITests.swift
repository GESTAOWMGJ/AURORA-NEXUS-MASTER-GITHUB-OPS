import XCTest

final class AuroraNexusUITests: XCTestCase {
    func testNativeVersionAndIntegrationCenterWithoutCredentialsOrNetwork() {
        let app = XCUIApplication()
        app.launchArguments = ["--aurora-ui-test"]
        app.launch()
        XCTAssertTrue(app.staticTexts["synthetic-portal"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Versão e integração"].tap()
        XCTAssertTrue(app.staticTexts["integration-pending"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["native-release-id"].exists)
        app.swipeUp()
        XCTAssertTrue(app.staticTexts["diagnostic-status"].exists)
        XCTAssertTrue(app.buttons["diagnose-origin"].exists)
        XCTAssertFalse(app.buttons["diagnose-origin"].isEnabled)
    }
}
