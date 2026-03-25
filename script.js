function atualizarVendas() {
    const corpo = document.getElementById('corpo-tabela-vendas');
    corpo.innerHTML = '';
    let total = 0;
    vendas.forEach(v => {
        corpo.innerHTML += `<tr>
            <td>${v.data}</td>
            <td>${v.cliente}</td>
            <td>${v.produto}</td>
            <td>R$ ${v.preco.toFixed(2)}</td>
        </tr>`;
        total += v.preco;
    });
    document.getElementById('total-caixa').innerText = `Total em Caixa: R$ ${total.toFixed(2)}`;
}
