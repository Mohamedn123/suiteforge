define([], () => {
    /** Calculate a total from the supplied amount. */
    function internalCalculate(amount) {
        return amount * 2;
    }
    return { calculate: internalCalculate };
});
