document.getElementById('form-venda').addEventListener('submit', function(e) {
    e.preventDefault();
    const cliente = document.getElementById('select-venda-cliente').value;
    const produto = document.getElementById('prod-nome').value.trim();
    const preco = parseFloat(document.getElementById('prod-preco').value);

    if(cliente && produto && preco > 0) {
        const venda = {
            data: new Date().toLocaleString(),
            cliente,
            produto,
            preco
        };
        vendas.push(venda);
        localStorage.setItem('db_vendas_spfc', JSON.stringify(vendas));
        atualizarVendas();
        document.getElementById('form-venda').reset();
    }
});
