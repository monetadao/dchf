const DfrancMathTester = artifacts.require('./DfrancMathTester.sol')

contract('LiquityMath', async (accounts) => {
  let dfrancMathTester
  beforeEach('deploy tester', async () => {
    dfrancMathTester = await DfrancMathTester.new()
  })

  const checkFunction = async (func, cond, params) => {
    assert.equal(await dfrancMathTester[func](...params), cond(...params))
  }

  it('max works if a > b', async () => {
    await checkFunction('callMax', (a, b) => Math.max(a, b), [2, 1])
  })

  it('max works if a = b', async () => {
    await checkFunction('callMax', (a, b) => Math.max(a, b), [2, 2])
  })

  it('max works if a < b', async () => {
    await checkFunction('callMax', (a, b) => Math.max(a, b), [1, 2])
  })
})
