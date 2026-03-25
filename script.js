document.getElementById('form-cliente').addEventListener('submit', function(e) {
    e.preventDefault();
    const nome = document.getElementById('nome-cliente').value.trim();
    if(nome) {
        clientes.push(nome);
        localStorage.setItem('db_clientes_spfc', JSON.stringify(clientes));
        atualizarClientes();
        document.getElementById('form-cliente').reset();
    }
});
